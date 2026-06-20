const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, AttachmentBuilder } = require('discord.js');
const path = require('path');
const { getBalance, debit, credit } = require('../utils/wallet');
const embeds = require('../utils/embeds');

// ─── Constants ───
const MIN_WAGER = 50;
const CHALLENGE_TIMEOUT_MS = 60_000;  // 60 seconds to accept/decline
const TURN_TIMEOUT_MS = 30_000;       // 30 seconds per turn
const CHAMBERS = 6;

// Local GIF paths
const ASSETS_DIR = path.join(__dirname, '../assets/roulette');
const BANG_GIF = path.join(ASSETS_DIR, 'bang.gif');
const CLICK_GIF = path.join(ASSETS_DIR, 'click.gif');
const CHALLENGE_GIF = path.join(ASSETS_DIR, 'challenge.gif');
const TURN_GIF = path.join(ASSETS_DIR, 'turn.gif');
const START_GIF = path.join(ASSETS_DIR, 'start.gif');
const SELF_GIF = path.join(ASSETS_DIR, 'self.gif');
const ENEMY_GIF = path.join(ASSETS_DIR, 'enemy.gif');

// In-memory active games (channelId → game state)
const activeGames = new Map();

// ─── Helper: Build the challenge embed ───
function buildChallengeEmbed(challenger, opponent, wager) {
  const file = new AttachmentBuilder(CHALLENGE_GIF, { name: 'challenge.gif' });
  const embed = new EmbedBuilder()
    .setColor(embeds.COLORS.roulette)
    .setTitle('🔫 Russian Roulette — Face Off!')
    .setDescription(
      `**${challenger.username}** has challenged **${opponent.username}** to a deadly game of Russian Roulette!\n\n` +
      `💰 **Wager:** ${wager.toLocaleString()} Mochi Coins each\n` +
      `🏆 **Prize Pool:** ${(wager * 2).toLocaleString()} Mochi Coins\n\n` +
      `*A 6-chamber revolver. One bullet. Take turns pulling the trigger.*\n*The survivor takes it all.*\n\n` +
      `⏳ ${opponent.username}, you have **60 seconds** to respond!`
    )
    .setThumbnail(challenger.displayAvatarURL({ dynamic: true }))
    .setImage('attachment://challenge.gif')
    .setFooter({ text: '🍡 Mochi Bot — Russian Roulette' })
    .setTimestamp();

  return { embed, file };
}

// ─── Helper: Build the turn embed ───
function buildTurnEmbed(activePlayer, otherPlayer, chamberPosition, totalChambers, wager) {
  const probability = Math.round((1 / (totalChambers - chamberPosition)) * 100);
  const filled = Math.min(Math.floor(probability / 5), 20);
  const tensionBar = '█'.repeat(filled) + '░'.repeat(20 - filled);

  const file = new AttachmentBuilder(TURN_GIF, { name: 'turn.gif' });
  const embed = new EmbedBuilder()
    .setColor(chamberPosition >= 3 ? 0xFF0000 : embeds.COLORS.roulette)
    .setTitle(`🔫 ${activePlayer.username}'s Turn`)
    .setDescription(
      `The cylinder spins...\n\n` +
      `🎯 **Chamber ${chamberPosition + 1} of ${totalChambers}**\n` +
      `💀 Death Chance: **${probability}%**\n` +
      `\`${tensionBar}\` \n\n` +
      `**${activePlayer.username}**, who do you aim at?\n\n` +
      `🔫 **Shoot Self:** Blank = Pass Turn | Bullet = Lose\n` +
      `🎯 **Shoot Enemy:** Blank = Pass Turn | Bullet = Win\n\n` +
      `⏳ *30 seconds before auto-forfeit*`
    )
    .setThumbnail(activePlayer.displayAvatarURL({ dynamic: true }))
    .setImage('attachment://turn.gif')
    .setFooter({ text: `💰 ${(wager * 2).toLocaleString()} coins on the line` })
    .setTimestamp();
    
  return { embed, file };
}

// ─── Helper: Build the CLICK (survived) embed ───
function buildClickEmbed(player, target, chamberPosition, totalChambers) {
  const isSelf = player.id === target.id;
  const targetName = isSelf ? 'themselves' : `**${target.username}**`;
  const reaction = isSelf ? 'sweats nervously as the chamber clicks empty... The gun is passed over.' : 'clicks empty! The gun is passed over...';

  const gifPath = isSelf ? SELF_GIF : ENEMY_GIF;
  const gifName = isSelf ? 'self.gif' : 'enemy.gif';
  const file = new AttachmentBuilder(gifPath, { name: gifName });

  const embed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle('*click...* 💨')
    .setDescription(
      `**${player.username}** aimed at ${targetName} and pulled the trigger...\n\n` +
      `✅ **BLANK!** Chamber ${chamberPosition + 1}/${totalChambers} was empty.\n\n` +
      `**${player.username}** ${reaction}`
    )
    .setImage(`attachment://${gifName}`)
    .setFooter({ text: '🍡 Mochi Bot — Russian Roulette' })
    .setTimestamp();

  return { embed, file };
}

// ─── Helper: Build the BANG (eliminated) embed ───
function buildBangEmbed(shooter, target, winner, loser, wager) {
  const isSelf = shooter.id === target.id;
  const targetName = isSelf ? 'themselves' : `**${target.username}**`;

  const file = new AttachmentBuilder(BANG_GIF, { name: 'bang.gif' });
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
    .setImage('attachment://bang.gif')
    .setFooter({ text: '🍡 Mochi Bot — Russian Roulette' })
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
    .setFooter({ text: '🍡 Mochi Bot — Russian Roulette' })
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
    const { embed: turnEmbed, file: turnFile } = buildTurnEmbed(activePlayer, otherPlayer, currentChamber, CHAMBERS, wager);
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

    await gameMessage.edit({ embeds: [turnEmbed], components: [pullButtons], files: [turnFile] });

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
        await credit(winner.id, guildId, wager * 2, 'roulette_win', `Won Russian Roulette vs ${loser.username} (${(wager * 2).toLocaleString()} coins)`);

        activeGames.delete(gameId);
        return;
      } else {
        // Click... survived (Blank)
        const { embed: clickEmbed, file: clickFile } = buildClickEmbed(activePlayer, target, currentChamber, CHAMBERS);
        await gameMessage.edit({ embeds: [clickEmbed], components: [], files: [clickFile] });

        // Brief dramatic pause
        await new Promise((resolve) => setTimeout(resolve, 3500));

        currentChamber++;
        turnIndex++; // Turn always passes after a blank shot
      }
    } catch (err) {
      // Timeout — active player forfeits
      const forfeitEmbed = buildForfeitEmbed(activePlayer, otherPlayer, wager);
      await gameMessage.edit({ embeds: [forfeitEmbed], components: [] });

      // Payout to the winner
      await credit(otherPlayer.id, guildId, wager * 2, 'roulette_win', `Won Russian Roulette by forfeit vs ${activePlayer.username}`);

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
      await message.reply({ embeds: [embeds.error('Game in Progress', 'There\'s already a Russian Roulette game running in this channel! Wait for it to finish.')] });
      return;
    }

    // Parse opponent
    const opponent = message.mentions.users.first();
    if (!opponent) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi roulette @user <amount>`\nChallenge someone to Russian Roulette!')] });
      return;
    }

    if (opponent.id === message.author.id) {
      await message.reply({ embeds: [embeds.error('Nice Try', 'You can\'t play Russian Roulette against yourself! 💀')] });
      return;
    }

    if (opponent.bot) {
      await message.reply({ embeds: [embeds.error('Invalid Target', 'You can\'t challenge a bot to Russian Roulette!')] });
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
        .setLabel('❌ Decline')
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
          if (i.user.id !== opponent.id) {
            i.reply({ content: `❌ Only **${opponent.username}** can respond to this challenge!`, ephemeral: true });
            return false;
          }
          return true;
        },
        componentType: ComponentType.Button,
        time: CHALLENGE_TIMEOUT_MS,
      });

      await response.deferUpdate();

      if (response.customId.startsWith('rr_decline_')) {
        // Declined
        activeGames.delete(channelId);
        const declineEmbed = new EmbedBuilder()
          .setColor(0x95A5A6)
          .setTitle('🔫 Challenge Declined')
          .setDescription(`**${opponent.username}** chickened out! 🐔\nThe Russian Roulette match has been cancelled.`)
          .setFooter({ text: '🍡 Mochi Bot — Russian Roulette' })
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
        await debit(message.author.id, guildId, wager, 'roulette_wager', `Russian Roulette wager vs ${opponent.username}`);
      } catch (debitErr) {
        activeGames.delete(channelId);
        await challengeMsg.edit({
          embeds: [embeds.error('Insufficient Funds', `**${message.author.username}** no longer has enough coins! Match cancelled.`)],
          components: [], content: null,
        });
        return;
      }

      try {
        await debit(opponent.id, guildId, wager, 'roulette_wager', `Russian Roulette wager vs ${message.author.username}`);
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
        .setTitle('🔫 The Game Begins...')
        .setDescription(
          `Both players have put up **${wager.toLocaleString()}** Mochi Coins.\n\n` +
          `*The cylinder spins... the bullet is loaded...*\n` +
          `*Someone isn't making it out alive.* 💀\n\n` +
          `**Prize Pool: ${(wager * 2).toLocaleString()} Mochi Coins**`
        )
        .setImage('attachment://start.gif')
        .setFooter({ text: '🍡 Mochi Bot — Russian Roulette' })
        .setTimestamp();

      await challengeMsg.edit({ embeds: [startEmbed], components: [], files: [startFile], content: null });

      // Brief dramatic pause before first turn
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Play the game
      try {
        await playRoulette(message, message.author, opponent, wager, guildId, challengeMsg);
      } catch (gameErr) {
        console.error('❌ Russian Roulette game error:', gameErr);
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
        } catch {}
      }

    } catch (err) {
      // Challenge timed out
      activeGames.delete(channelId);
      const timeoutEmbed = new EmbedBuilder()
        .setColor(0x95A5A6)
        .setTitle('⏰ Challenge Expired')
        .setDescription(`**${opponent.username}** didn't respond in time.\nThe Russian Roulette challenge has been cancelled.`)
        .setFooter({ text: '🍡 Mochi Bot — Russian Roulette' })
        .setTimestamp();
      await challengeMsg.edit({ embeds: [timeoutEmbed], components: [], content: null });
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
      .setTitle(`🔫 Russian Roulette Stats`)
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
      .setFooter({ text: '🍡 Mochi Bot — Russian Roulette' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  },
};

module.exports = rouletteCommands;
