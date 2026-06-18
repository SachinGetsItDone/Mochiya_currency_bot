const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const config = require('./config');
const economyCommands = require('./commands/economy');
const tournamentCommands = require('./commands/tournament');
const bettingCommands = require('./commands/betting');
const shopCommands = require('./commands/shop');
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
};

// Add aliases and register
for (const [name, handler] of Object.entries(allCommands)) {
  commands.set(name, handler);
}

// Aliases & Status commands
commands.set('flex', shopCommands.collection);
commands.set('tradecancel', shopCommands.tradecancel);
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

    help_admin: new (require('discord.js').EmbedBuilder)()
      .setColor(0x36393F)
      .setTitle('🔒 Admin Commands')
      .setDescription(`
• \`give        \` — Grant coins (\`give @user <amount>\`)

• \`setbudget   \` — Set tournament budget (\`setbudget @user <amount>\`)

• \`addplayer   \` — Add player to pool (\`addplayer <name> <price>\`)

• \`creatematch \` — Open match (\`creatematch <PlayerA> vs <PlayerB>\`)

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
