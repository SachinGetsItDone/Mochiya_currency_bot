const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, AttachmentBuilder } = require('discord.js');
const path = require('path');
const { getBalance, debit, credit } = require('../utils/wallet');
const embeds = require('../utils/embeds');

// ─── Constants ───
const MIN_WAGER = 50;
const TURN_TIMEOUT_MS = 30_000;       // 30 seconds per turn
const CHAMBERS = 6;

// Local GIF paths
const ASSETS_DIR = path.join(__dirname, '../assets/roulette');

const CHALLENGE_GIF = path.join(ASSETS_DIR, 'challenge.gif');
const START_GIF = path.join(ASSETS_DIR, 'start.gif');

// Distinct shot outcome GIFs
const GIFS = {
  self_empty: path.join(ASSETS_DIR, 'self_empty.gif'),
  self_bang: path.join(ASSETS_DIR, 'self_bang.gif'),
  enemy_empty: path.join(ASSETS_DIR, 'enemy_empty.gif'),
  enemy_bang: path.join(ASSETS_DIR, 'enemy_bang.gif'),
  winner: path.join(ASSETS_DIR, 'winner.gif'),
};

// In-memory active games (channelId → game state)
const activeGames = new Map();

// ─── Helper: Build the challenge embed ───
function buildChallengeEmbed(challenger, opponent, wager) {
  const file = new AttachmentBuilder(CHALLENGE_GIF, { name: 'challenge.gif' });
  const embed = new EmbedBuilder()
    .setColor(embeds.COLORS.roulette)
    .setTitle('🩸 Buckshot Roulette — Face Off!')
    .setDescription(
      `**${challenger.username}** has challenged **${opponent.username}** to a deadly game of Buckshot Roulette!\n\n` +
      `💰 **Wager:** ${wager.toLocaleString()} Mochi Coins each\n` +
      `🏆 **Prize Pool:** ${(wager * 2).toLocaleString()} Mochi Coins\n\n` +
      `*A 12-gauge shotgun. One live shell. Take turns pulling the trigger.*\n*The survivor takes it all.*\n\n` +
      `⏳ ${opponent.username}, waiting for your response...`
    )
    .setThumbnail(challenger.displayAvatarURL({ dynamic: true }))
    .setImage('attachment://challenge.gif')
    .setFooter({ text: '🍡 Mochi Bot — Buckshot Roulette' })
    .setTimestamp();

  return { embed, file };
}

// ─── Helper: Build the turn embed ───
function buildTurnEmbed(activePlayer, otherPlayer, chamberPosition, totalChambers, wager) {
  const probability = Math.round((1 / (totalChambers - chamberPosition)) * 100);

  const embed = new EmbedBuilder()
    .setColor(chamberPosition >= 3 ? 0xFF0000 : embeds.COLORS.roulette)
    .setTitle(`🩸 ${activePlayer.username}'s Turn`)
    .setDescription(
      `The shotgun is pumped...\n\n` +
      `🎯 **Shell ${chamberPosition + 1} of ${totalChambers}**\n` +
      `💀 Death Chance: **${probability}%**\n` +
      `Chambers: ${'⚪'.repeat(chamberPosition)}${'🔴'.repeat(totalChambers - chamberPosition)}\n\n` +
      `**${activePlayer.username}**, who do you aim at?\n\n` +
      `🔫 **Shoot Self:** Blank = Pass Turn | Live Shell = Lose\n` +
      `🎯 **Shoot Enemy:** Blank = Pass Turn | Live Shell = Win\n\n` +
      `⏳ *30 seconds before auto-forfeit*`
    )
    .setThumbnail(activePlayer.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: `💰 ${(wager * 2).toLocaleString()} coins on the line` })
    .setTimestamp();

  return { embed };
}

// ─── Helper: Build the CLICK (survived) embed ───
function buildClickEmbed(player, target, chamberPosition, totalChambers) {
  const isSelf = player.id === target.id;
  const targetName = isSelf ? 'themselves' : `**${target.username}**`;
  const reaction = isSelf ? 'sweats nervously as the shotgun clicks empty... The shotgun is passed over.' : 'clicks empty! The shotgun is passed over...';

  const gifPath = isSelf ? GIFS.self_empty : GIFS.enemy_empty;
  const gifName = isSelf ? 'self_empty.gif' : 'enemy_empty.gif';
  const file = new AttachmentBuilder(gifPath, { name: gifName });

  const embed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle('*click...* 💨')
    .setDescription(
      `**${player.username}** aimed at ${targetName} and pulled the trigger...\n\n` +
      `✅ **BLANK!** Shell ${chamberPosition + 1}/${totalChambers} was empty.\n\n` +
      `**${player.username}** ${reaction}`
    )
    .setImage(`attachment://${gifName}`)
    .setFooter({ text: '🍡 Mochi Bot — Buckshot Roulette' })
    .setTimestamp();

  return { embed, file };
}

// ─── Helper: Build the BANG (eliminated) embed ───
function buildBangEmbed(shooter, target, winner, loser, wager) {
  const isSelf = shooter.id === target.id;
  const targetName = isSelf ? 'themselves' : `**${target.username}**`;

  const gifPath = isSelf ? GIFS.self_bang : GIFS.enemy_bang;
  const gifName = isSelf ? 'self_bang.gif' : 'enemy_bang.gif';
  const file = new AttachmentBuilder(gifPath, { name: gifName });

  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('💥 BANG!!! 💀')
    .setDescription(
      `**${shooter.username}** aimed at ${targetName} and pulled the trigger...\n\n` +
      `# 💀 SHOT! 💀\n\n` +
      `**${loser.username}** goes down!\n\n` +
      `💰 **${winner.username}** survives and wins **${(wager * 2).toLocaleString()}** Mochi Coins! 🎉\n` +
      `💸 **${loser.username}** lost **${wager.toLocaleString()}** Mochi Coins.`
    )
    .setImage(`attachment://${gifName}`)
    .setFooter({ text: '🍡 Mochi Bot — Buckshot Roulette' })
    .setTimestamp();

  return { embed, file };
}

// ─── Helper: Build the forfeit embed ───
function buildForfeitEmbed(forfeiter, winner, wager, reason = 'timed out') {
  return new EmbedBuilder()
    .setColor(0x95A5A6)
    .setTitle('⏰ Time\'s Up — Forfeit!')
    .setDescription(
      `**${forfeiter.username}** ${reason}!\n\n` +
      `🏆 **${winner.username}** wins by default and takes **${(wager * 2).toLocaleString()}** Mochi Coins!`
    )
    .setFooter({ text: '🍡 Mochi Bot — Buckshot Roulette' })
    .setTimestamp();
}

// ─── Main Roulette Game Logic ───
async function playRoulette(message, challenger, opponent, wager, guildId, gameMessage) {
  // Determine bullet position (0-indexed)
  const bulletPosition = Math.floor(Math.random() * CHAMBERS);
  let currentChamber = 0;

  // Randomly decide who goes first
  let players = Math.random() < 0.5 ? [challenger, opponent] : [opponent, challenger];
  let turnIndex = 0;

  const gameId = message.channel.id;

  while (currentChamber < CHAMBERS) {
    const activePlayer = players[turnIndex % 2];
    const otherPlayer = players[(turnIndex + 1) % 2];

    // Build turn embed with action buttons
    const { embed: turnEmbed } = buildTurnEmbed(activePlayer, otherPlayer, currentChamber, CHAMBERS, wager);
    const pullButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rr_self_${gameId}_${currentChamber}`)
        .setLabel('🔫 Shoot Self')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`rr_enemy_${gameId}_${currentChamber}`)
        .setLabel('🎯 Shoot Enemy')
        .setStyle(ButtonStyle.Danger)
    );

    await gameMessage.edit({ embeds: [turnEmbed], components: [pullButtons], files: [] });

    // Wait for the active player to click
    try {
      const btnInteraction = await gameMessage.awaitMessageComponent({
        filter: (i) => {
          if (i.user.id !== activePlayer.id) {
            i.reply({ content: `❌ It's not your turn! Waiting for **${activePlayer.username}**.`, ephemeral: true });
            return false;
          }
          return true;
        },
        componentType: ComponentType.Button,
        time: TURN_TIMEOUT_MS,
      });

      await btnInteraction.deferUpdate();

      const action = btnInteraction.customId.split('_')[1]; // 'self' or 'enemy'
      const isSelf = action === 'self';
      const target = isSelf ? activePlayer : otherPlayer;
      const winner = isSelf ? otherPlayer : activePlayer;
      const loser = isSelf ? activePlayer : otherPlayer;

      // Check if this chamber has the bullet
      if (currentChamber === bulletPosition) {
        // BANG! 💥
        const { embed: bangEmbed, file: bangFile } = buildBangEmbed(activePlayer, target, winner, loser, wager);
        await gameMessage.edit({ embeds: [bangEmbed], components: [], files: [bangFile] });

        // Payout to the winner
        await credit(winner.id, guildId, wager * 2, 'roulette_win', `Won Buckshot Roulette vs ${loser.username} (${(wager * 2).toLocaleString()} coins)`);

        // Safely end game in state before sending secondary messages
        activeGames.delete(gameId);

        // Send victory message
        try {
          await new Promise((resolve) => setTimeout(resolve, 6000));
          const winnerFile = new AttachmentBuilder(GIFS.winner, { name: 'winner.gif' });
          const winnerEmbed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('🎉 VICTORY! 🎉')
            .setDescription(`**${winner.username}** takes home **${(wager * 2).toLocaleString()}** Mochi Coins!`)
            .setImage('attachment://winner.gif');
          await gameMessage.reply({ embeds: [winnerEmbed], files: [winnerFile] });
        } catch (e) {
          console.error('Failed to send winner message:', e);
        }

        return;
      } else {
        // Click... survived (Blank)
        const { embed: clickEmbed, file: clickFile } = buildClickEmbed(activePlayer, target, currentChamber, CHAMBERS);
        await gameMessage.edit({ embeds: [clickEmbed], components: [], files: [clickFile] });

        // Brief dramatic pause
        await new Promise((resolve) => setTimeout(resolve, 6000));

        currentChamber++;
        turnIndex++; // Turn always passes after a blank shot
      }
    } catch (err) {
      // Timeout — active player forfeits
      try {
        const forfeitEmbed = buildForfeitEmbed(activePlayer, otherPlayer, wager);
        await gameMessage.edit({ embeds: [forfeitEmbed], components: [] });
      } catch (editErr) {
        console.error('Failed to edit forfeit message:', editErr);
      }

      // Payout to the winner
      await credit(otherPlayer.id, guildId, wager * 2, 'roulette_win', `Won Buckshot Roulette by forfeit vs ${activePlayer.username}`);

      activeGames.delete(gameId);
      return;
    }
  }
}

// ─── Commands ───
const rouletteCommands = {
  // ─── roulette ───
  async roulette(message, args, guildId) {
    const channelId = message.channel.id;

    // Check if a game is already active in this channel
    if (activeGames.has(channelId)) {
      await message.reply({ embeds: [embeds.error('Game in Progress', 'There\'s already a Buckshot Roulette game running in this channel! Wait for it to finish.')] });
      return;
    }

    // Parse opponent
    const opponent = message.mentions.users.first();
    if (!opponent) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi roulette @user <amount>`\nChallenge someone to Buckshot Roulette!')] });
      return;
    }

    if (opponent.id === message.author.id) {
      await message.reply({ embeds: [embeds.error('Nice Try', 'You can\'t play Buckshot Roulette against yourself! 💀')] });
      return;
    }

    if (opponent.bot) {
      await message.reply({ embeds: [embeds.error('Invalid Target', 'You can\'t challenge a bot to Buckshot Roulette!')] });
      return;
    }

    // Parse wager
    const wager = parseInt(args[1]);
    if (isNaN(wager) || wager < MIN_WAGER) {
      await message.reply({ embeds: [embeds.error('Invalid Wager', `Minimum wager is **${MIN_WAGER}** Mochi Coins.\nUsage: \`mochi roulette @user <amount>\``)] });
      return;
    }

    // Check balances
    const challengerBalance = await getBalance(message.author.id, guildId);
    if (challengerBalance < wager) {
      await message.reply({ embeds: [embeds.error('Insufficient Funds', `You only have **${challengerBalance.toLocaleString()}** Mochi Coins. You need **${wager.toLocaleString()}** to play.`)] });
      return;
    }

    const opponentBalance = await getBalance(opponent.id, guildId);
    if (opponentBalance < wager) {
      await message.reply({ embeds: [embeds.error('Opponent Broke', `**${opponent.username}** only has **${opponentBalance.toLocaleString()}** Mochi Coins. They can\'t match the wager.`)] });
      return;
    }

    // Mark game as pending
    activeGames.set(channelId, { status: 'pending', challenger: message.author.id, opponent: opponent.id });

    // Send challenge
    const { embed: challengeEmbed, file: challengeFile } = buildChallengeEmbed(message.author, opponent, wager);
    const challengeButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rr_accept_${channelId}`)
        .setLabel('✅ Accept')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`rr_decline_${channelId}`)
        .setLabel('❌ Decline / Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    const challengeMsg = await message.reply({
      content: `<@${opponent.id}> — you've been challenged! 🔫`,
      embeds: [challengeEmbed],
      components: [challengeButtons],
      files: [challengeFile]
    });

    // Wait for opponent response
    try {
      const response = await challengeMsg.awaitMessageComponent({
        filter: (i) => {
          if (i.customId.startsWith('rr_decline_') && i.user.id === message.author.id) {
            return true; // Challenger can cancel
          }
          if (i.user.id !== opponent.id) {
            i.reply({ content: `❌ Only **${opponent.username}** can respond to this challenge! (The challenger can also cancel it).`, ephemeral: true });
            return false;
          }
          return true;
        },
        componentType: ComponentType.Button,
      });

      await response.deferUpdate();

      if (response.customId.startsWith('rr_decline_')) {
        // Declined or Cancelled
        const isCancelling = response.user.id === message.author.id;
        activeGames.delete(channelId);
        
        const declineEmbed = new EmbedBuilder()
          .setColor(0x95A5A6)
          .setTitle(isCancelling ? '🔫 Challenge Cancelled' : '🔫 Challenge Declined')
          .setDescription(
            isCancelling 
              ? `**${message.author.username}** cancelled their challenge.` 
              : `**${opponent.username}** chickened out! 🐔\nThe Buckshot Roulette match has been cancelled.`
          )
          .setFooter({ text: '🍡 Mochi Bot — Buckshot Roulette' })
          .setTimestamp();
        await challengeMsg.edit({ embeds: [declineEmbed], components: [], content: null });
        return;
      }

      // Accepted! Deduct wagers from both players
      // Re-check balances to prevent race conditions
      const freshChallengerBal = await getBalance(message.author.id, guildId);
      const freshOpponentBal = await getBalance(opponent.id, guildId);

      if (freshChallengerBal < wager || freshOpponentBal < wager) {
        activeGames.delete(channelId);
        await challengeMsg.edit({
          embeds: [embeds.error('Insufficient Funds', 'One of the players no longer has enough coins! Match cancelled.')],
          components: [],
          content: null,
        });
        return;
      }

      try {
        await debit(message.author.id, guildId, wager, 'roulette_wager', `Buckshot Roulette wager vs ${opponent.username}`);
      } catch (debitErr) {
        activeGames.delete(channelId);
        await challengeMsg.edit({
          embeds: [embeds.error('Insufficient Funds', `**${message.author.username}** no longer has enough coins! Match cancelled.`)],
          components: [], content: null,
        });
        return;
      }

      try {
        await debit(opponent.id, guildId, wager, 'roulette_wager', `Buckshot Roulette wager vs ${message.author.username}`);
      } catch (debitErr) {
        // Refund the challenger since opponent's debit failed
        await credit(message.author.id, guildId, wager, 'roulette_refund', `Refund — opponent couldn't match wager`);
        activeGames.delete(channelId);
        await challengeMsg.edit({
          embeds: [embeds.error('Insufficient Funds', `**${opponent.username}** no longer has enough coins! Match cancelled. ${message.author.username} has been refunded.`)],
          components: [], content: null,
        });
        return;
      }

      // Update game state
      activeGames.set(channelId, { status: 'playing', challenger: message.author.id, opponent: opponent.id });

      // Start the game!
      const startFile = new AttachmentBuilder(START_GIF, { name: 'start.gif' });
      const startEmbed = new EmbedBuilder()
        .setColor(embeds.COLORS.roulette)
        .setTitle('🩸 The Game Begins...')
        .setDescription(
          `Both players have put up **${wager.toLocaleString()}** Mochi Coins.\n\n` +
          `*The shotgun is pumped... the shell is loaded...*\n` +
          `*Someone isn't making it out alive.* 💀\n\n` +
          `**Prize Pool: ${(wager * 2).toLocaleString()} Mochi Coins**`
        )
        .setImage('attachment://start.gif')
        .setFooter({ text: '🍡 Mochi Bot — Buckshot Roulette' })
        .setTimestamp();

      await challengeMsg.edit({ embeds: [startEmbed], components: [], files: [startFile], content: null });

      // Brief dramatic pause before first turn
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Play the game
      try {
        await playRoulette(message, message.author, opponent, wager, guildId, challengeMsg);
      } catch (gameErr) {
        console.error('❌ Buckshot Roulette game error:', gameErr);
        activeGames.delete(channelId);
        // Refund both players on unexpected crash
        try {
          await credit(message.author.id, guildId, wager, 'roulette_refund', 'Refund — game crashed');
          await credit(opponent.id, guildId, wager, 'roulette_refund', 'Refund — game crashed');
        } catch (refundErr) {
          console.error('❌ Failed to refund after game crash:', refundErr);
        }
        try {
          await challengeMsg.edit({
            embeds: [embeds.error('Game Error', 'Something went wrong during the game! Both players have been refunded.')],
            components: [],
          });
        } catch { }
      }

    } catch (err) {
      // Message deleted or collector ended unexpectedly
      activeGames.delete(channelId);
      try {
        const timeoutEmbed = new EmbedBuilder()
          .setColor(0x95A5A6)
          .setTitle('⏰ Challenge Cancelled')
          .setDescription(`The challenge message was removed. Match cancelled.`)
          .setFooter({ text: '🍡 Mochi Bot — Buckshot Roulette' })
          .setTimestamp();
        await challengeMsg.edit({ embeds: [timeoutEmbed], components: [], content: null });
      } catch (e) {
        // Message is likely gone, so we can't edit it
      }
    }
  },

  // ─── roulettestats ───
  async roulettestats(message, args, guildId) {
    const { supabase } = require('../utils/supabase');
    const userId = message.author.id;

    // Count wins from transactions
    const { count: wins } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .eq('to_user', userId)
      .eq('type', 'roulette_win');

    // Count losses from transactions (wager debits without corresponding win)
    const { count: totalGames } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .eq('from_user', userId)
      .eq('type', 'roulette_wager');

    const winCount = wins || 0;
    const gameCount = totalGames || 0;
    const lossCount = gameCount - winCount;
    const winRate = gameCount > 0 ? Math.round((winCount / gameCount) * 100) : 0;

    // Get total earnings
    const { data: earnings } = await supabase
      .from('transactions')
      .select('amount')
      .eq('guild_id', guildId)
      .eq('to_user', userId)
      .eq('type', 'roulette_win');

    const totalEarned = earnings?.reduce((sum, t) => sum + t.amount, 0) || 0;

    // Get total wagered
    const { data: wagers } = await supabase
      .from('transactions')
      .select('amount')
      .eq('guild_id', guildId)
      .eq('from_user', userId)
      .eq('type', 'roulette_wager');

    const totalWagered = wagers?.reduce((sum, t) => sum + t.amount, 0) || 0;
    const netProfit = totalEarned - totalWagered;

    const embed = new EmbedBuilder()
      .setColor(embeds.COLORS.roulette)
      .setTitle(`🔫 Buckshot Roulette Stats`)
      .setDescription(`Stats for **${message.author.username}**`)
      .addFields(
        { name: '🎮 Games Played', value: `**${gameCount}**`, inline: true },
        { name: '🏆 Wins', value: `**${winCount}**`, inline: true },
        { name: '💀 Deaths', value: `**${lossCount}**`, inline: true },
        { name: '📊 Win Rate', value: `**${winRate}%**`, inline: true },
        { name: '💰 Total Earned', value: `**${totalEarned.toLocaleString()}** coins`, inline: true },
        { name: `${netProfit >= 0 ? '📈' : '📉'} Net Profit`, value: `**${netProfit >= 0 ? '+' : ''}${netProfit.toLocaleString()}** coins`, inline: true },
      )
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: '🍡 Mochi Bot — Buckshot Roulette' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  },
};

module.exports = rouletteCommands;
