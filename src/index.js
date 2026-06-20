const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const config = require('./config');
const { supabase } = require('./utils/supabase');
const { getBalance, credit, debit } = require('./utils/wallet');
const economyCommands = require('./commands/economy');
const tournamentCommands = require('./commands/tournament');
const bettingCommands = require('./commands/betting');
const shopCommands = require('./commands/shop');
const rouletteCommands = require('./commands/roulette');
const embeds = require('./utils/embeds');

// ─── Create Discord Client ───
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ─── Command Registry ───
const commands = new Collection();

// Register all commands
const allCommands = {
  // Economy
  ...economyCommands,
  // Tournament
  ...tournamentCommands,
  // Betting
  ...bettingCommands,
  // Shop
  ...shopCommands,
  // Buckshot Roulette
  ...rouletteCommands,
};

// Add aliases and register
for (const [name, handler] of Object.entries(allCommands)) {
  commands.set(name, handler);
}

// Aliases & Status commands
commands.set('flex', shopCommands.collection);
commands.set('tradecancel', shopCommands.tradecancel);
commands.set('canclematch', bettingCommands.cancelmatch);
commands.set('ping', async (message) => {
  const sent = await message.reply('Pinging...');
  const latency = sent.createdTimestamp - message.createdTimestamp;
  const embed = embeds.success('Mochi Bot Latency 🏓', `Roundtrip latency: **${latency}ms**\nAPI Latency: **${Math.round(client.ws.ping)}ms**`);
  await sent.edit({ content: null, embeds: [embed] });
});

// ─── Event: Ready ───
client.once('ready', () => {
  console.log(`✅ Mochi Bot is online! Logged in as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} server(s)`);
  console.log(`🔧 Prefix: "${config.prefix}"`);

  // Set activity
  client.user.setActivity(`${config.prefix} help`, { type: 'WATCHING' });
});

// ─── Event: Message Create ───
client.on('messageCreate', async (message) => {
  // Ignore bots and DMs
  if (message.author.bot || !message.guild) return;

  if (!message.content.toLowerCase().startsWith(config.prefix.toLowerCase())) return;

  // Parse command
  const args = message.content.slice(config.prefix.length).trim().split(/\s+/);
  const commandName = args.shift()?.toLowerCase();

  if (!commandName) return;

  const guildId = message.guild.id;

  // Handle help command
  if (commandName === 'help') {
    await sendHelp(message);
    return;
  }

  // Find command
  const command = commands.get(commandName);
  if (!command) return; // Unknown command, silently ignore

  try {
    await command(message, args, guildId);
  } catch (error) {
    console.error(`❌ Error in command "${commandName}":`, error);

    const errorEmbed = embeds.error(
      'Oops! 💥',
      'Something went wrong while executing that command. Please try again later.'
    );

    // Only reply if we haven't already
    try {
      await message.reply({ embeds: [errorEmbed] });
    } catch (replyError) {
      console.error('Failed to send error message:', replyError);
    }
  }
});

// ─── Event: Interaction Create (Buttons & Modals) ───
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    const customId = interaction.customId;
    if (customId.startsWith('bet_a_') || customId.startsWith('bet_b_')) {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const isPlayerA = customId.startsWith('bet_a_');
      const matchId = customId.split('_')[2];

      const modal = new ModalBuilder()
        .setCustomId(`bet_modal_${isPlayerA ? 'a' : 'b'}_${matchId}`)
        .setTitle('Place Match Bet 🎲');

      const amountInput = new TextInputBuilder()
        .setCustomId('bet_amount')
        .setLabel('How much coins do you want to bet?')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter coin amount (e.g. 500)')
        .setRequired(true);

      const actionRow = new ActionRowBuilder().addComponents(amountInput);
      modal.addComponents(actionRow);

      await interaction.showModal(modal);
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    const customId = interaction.customId;
    if (customId.startsWith('bet_modal_')) {
      await interaction.deferReply({ ephemeral: true });
      const parts = customId.split('_');
      const playerLetter = parts[2];
      const matchId = parseInt(parts[3]);
      const amountStr = interaction.fields.getTextInputValue('bet_amount');
      const amount = parseInt(amountStr);

      if (isNaN(amount) || amount <= 0) {
        await interaction.followUp({ content: '❌ Please enter a valid positive number for your bet.', ephemeral: true });
        return;
      }

      const guildId = interaction.guild.id;

      // Fetch match
      const { data: match, error } = await supabase
        .from('matches')
        .select('*')
        .eq('id', matchId)
        .eq('guild_id', guildId)
        .eq('status', 'open')
        .single();

      if (error || !match) {
        await interaction.followUp({ content: '❌ This match is no longer open for betting.', ephemeral: true });
        return;
      }

      const playerName = playerLetter === 'a' ? match.player_a : match.player_b;

      // Check if user already placed a bet on this match
      const { data: existingBet } = await supabase
        .from('match_bets')
        .select('id')
        .eq('match_id', match.id)
        .eq('user_id', interaction.user.id)
        .single();

      if (existingBet) {
        await interaction.followUp({ content: '❌ You have already placed a bet on this match. Only one bet is allowed.', ephemeral: true });
        return;
      }

      // Check balance
      const balance = await getBalance(interaction.user.id, guildId);
      if (balance < amount) {
        await interaction.followUp({ content: `❌ Insufficient funds. You only have **${balance.toLocaleString()}** Mochi Coins.`, ephemeral: true });
        return;
      }

      // Deduct coins & record bet
      try {
        await debit(interaction.user.id, guildId, amount, 'match_bet', `Bet on ${playerName} in Match #${match.id}`);
        const { error: betError } = await supabase
          .from('match_bets')
          .insert({
            match_id: match.id,
            guild_id: guildId,
            user_id: interaction.user.id,
            supported: playerName,
            amount: amount,
          });

        if (betError) {
          await credit(interaction.user.id, guildId, amount, 'bet_refund', `Refund for failed bet on Match #${match.id}`);
          throw betError;
        }

        await interaction.followUp({ content: `✅ Bet placed successfully! You bet **${amount.toLocaleString()}** coins on **${playerName}**! 🍀`, ephemeral: true });
        
        // Optionally send a public notification in the channel
        await interaction.channel.send(`🎲 **${interaction.user.username}** placed a bet of **${amount.toLocaleString()}** coins on **${playerName}**!`);
      } catch (err) {
        console.error(err);
        await interaction.followUp({ content: '❌ Something went wrong while placing your bet.', ephemeral: true });
      }
    }
  }
});

// ─── Help Command with Interactive Dropdown ───
async function sendHelp(message) {
  const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

  const mainEmbed = new (require('discord.js').EmbedBuilder)()
    .setColor(embeds.COLORS.primary)
    .setTitle('🍡 Mochi Bot Help')
    .setDescription(`Welcome to Mochi Bot! Please select a category from the dropdown menu below to view the available commands.\n\nPrefix: \`${config.prefix} \``)
    .setFooter({ text: 'Select a category below' })
    .setTimestamp();

  const menu = new StringSelectMenuBuilder()
    .setCustomId('help_select')
    .setPlaceholder('Select a command category...')
    .addOptions([
      { label: '💰 Economy', description: 'Coins, Daily, Transfers, Top List', value: 'help_economy' },
      { label: '🏅 Tournament', description: 'Budget, Players Pool, Roster', value: 'help_tournament' },
      { label: '🎲 Match Betting', description: 'Open matches, bet, match info', value: 'help_betting' },
      { label: '🛒 Season Shop', description: 'Shop, buy items, trade & gift', value: 'help_shop' },
      { label: '🔫 Face-Off', description: 'Buckshot Roulette PvP game', value: 'help_roulette' },
      { label: '🔒 Admin Only', description: 'Add/remove items, set budgets, end matches', value: 'help_admin' },
    ]);

  const row = new ActionRowBuilder().addComponents(menu);

  const reply = await message.reply({ embeds: [mainEmbed], components: [row] });

  // Filter & collector
  const filter = (i) => i.customId === 'help_select' && i.user.id === message.author.id;
  const collector = reply.createMessageComponentCollector({ filter, time: 120000 }); // 2 minutes

  const categoryEmbeds = {
    help_economy: new (require('discord.js').EmbedBuilder)()
      .setColor(embeds.COLORS.gold)
      .setTitle('💰 Economy Commands')
      .setDescription(`
• \`cash       \` — Check your balance

• \`daily      \` — Claim daily coins (24h cooldown)

• \`pay @user  \` — Transfer coins

• \`top        \` — Leaderboard

• \`history    \` — View your transactions

• \`ping       \` — Check bot response latency
      `.trim()),

    help_tournament: new (require('discord.js').EmbedBuilder)()
      .setColor(embeds.COLORS.info)
      .setTitle('🏅 Tournament Commands')
      .setDescription(`
• \`budget    \` — Check your tournament budget

• \`players   \` — List available players

• \`buy       \` — Purchase a player (\`buy <playername>\`)

• \`roster    \` — View your team roster
      `.trim()),

    help_betting: new (require('discord.js').EmbedBuilder)()
      .setColor(embeds.COLORS.warning)
      .setTitle('🎲 Match Betting Commands')
      .setDescription(`
• \`matches   \` — List open matches

• \`matchinfo \` — Match details & bet stats (\`matchinfo <id>\`)

• \`support   \` — Place a bet (\`support <player> <amount>\`)
      `.trim()),

    help_shop: new (require('discord.js').EmbedBuilder)()
      .setColor(embeds.COLORS.primary)
      .setTitle('🛒 Season Shop Commands')
      .setDescription(`
• \`shop         \` — Browse items

• \`shopbuy      \` — Buy an item (\`shopbuy <item name>\`)

• \`collection   \` — View your items (\`collection\` / \`flex\`)

• \`gift         \` — Gift an item (\`gift @user <item name>\`)

• \`trade        \` — Propose trade (\`trade @user <your item> for <their item>\`)

• \`tradeaccept  \` — Accept a trade

• \`tradedecline \` — Decline a trade

• \`tradecancel  \` — Cancel your pending trade offer
      `.trim()),

    help_roulette: new (require('discord.js').EmbedBuilder)()
      .setColor(0x8B0000)
      .setTitle('🔫 Face-Off — Buckshot Roulette')
      .setDescription(`
• \`roulette      \` — Challenge a player (\`roulette @user <wager>\`)

• \`roulettestats \` — View your win/loss record

**How it works:**
🔫 6-chamber revolver, one bullet
🎯 Take turns pulling the trigger
💀 Get shot = lose your wager
🏆 Survive = win the entire pot (2× wager)
      `.trim()),

    help_admin: new (require('discord.js').EmbedBuilder)()
      .setColor(0x36393F)
      .setTitle('🔒 Admin Commands')
      .setDescription(`
• \`give        \` — Grant coins (\`give @user <amount>\`)

• \`setbudget   \` — Set tournament budget (\`setbudget @user <amount>\`)

• \`addplayer   \` — Add player to pool (\`addplayer <name> <price>\`)

• \`creatematch \` — Open match (\`creatematch <PlayerA> vs <PlayerB> [OddsA] [OddsB]\`)

• \`endmatch    \` — Close & payout (\`endmatch <id> <Winner>\`)

• \`cancelmatch \` — Cancel & refund (\`cancelmatch <id>\`)

• \`additem     \` — Add shop item (\`additem <name> <price> <stock> <expiry> <type> <rarity> <desc> [role_id]\`)

• \`removeitem  \` — Remove shop item (\`removeitem <item name>\`)
      `.trim()),
  };

  collector.on('collect', async (interaction) => {
    const selected = interaction.values[0];
    const newEmbed = categoryEmbeds[selected]
      .setFooter({ text: 'Mochi Bot Help' })
      .setTimestamp();

    await interaction.update({ embeds: [newEmbed] });
  });

  collector.on('end', async () => {
    // Disable components on timeout
    try {
      const disabledRow = new ActionRowBuilder().addComponents(
        StringSelectMenuBuilder.from(menu).setDisabled(true)
      );
      await reply.edit({ components: [disabledRow] });
    } catch {}
  });
}

// ─── Login ───
client.login(config.discord.token);
