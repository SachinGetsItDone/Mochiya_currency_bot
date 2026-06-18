const { supabase } = require('../utils/supabase');
const { getBalance, debit, credit } = require('../utils/wallet');
const { isAdmin } = require('../utils/permissions');
const embeds = require('../utils/embeds');

const bettingCommands = {
  // ─── creatematch (admin) ───
  async creatematch(message, args, guildId) {
    if (!isAdmin(message.member)) {
      await message.reply({ embeds: [embeds.error('Admin Only', 'You need **Administrator** permission to use this command.')] });
      return;
    }

    if (args.length < 2) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi creatematch <PlayerA> <PlayerB>`')] });
      return;
    }

    // Look for " vs " or " VS " separator in args to support multi-word player names
    const vsIndex = args.findIndex((a) => a.toLowerCase() === 'vs');
    let playerA, playerB, oddsA = null, oddsB = null;

    if (vsIndex !== -1) {
      playerA = args.slice(0, vsIndex).join(' ');
      const rest = args.slice(vsIndex + 1);
      
      // Check if last two args are numbers (odds)
      if (rest.length >= 3 && !isNaN(parseFloat(rest[rest.length - 2])) && !isNaN(parseFloat(rest[rest.length - 1]))) {
        oddsB = parseFloat(rest.pop());
        oddsA = parseFloat(rest.pop());
      }
      playerB = rest.join(' ');
    } else {
      // Fallback: PlayerB is last word, PlayerA is rest
      // If last two args are numbers, they are odds
      if (args.length >= 4 && !isNaN(parseFloat(args[args.length - 2])) && !isNaN(parseFloat(args[args.length - 1]))) {
        oddsB = parseFloat(args[args.length - 1]);
        oddsA = parseFloat(args[args.length - 2]);
        playerB = args[args.length - 3];
        playerA = args.slice(0, -3).join(' ');
      } else {
        playerB = args[args.length - 1];
        playerA = args.slice(0, -1).join(' ');
      }
    }

    if (!playerA || !playerB) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi creatematch <PlayerA> vs <PlayerB> [OddsA] [OddsB]`')] });
      return;
    }

    if (playerA.toLowerCase() === playerB.toLowerCase()) {
      await message.reply({ embeds: [embeds.error('Invalid Match', 'A player cannot compete against themselves!')] });
      return;
    }

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

    const { data: match, error } = await supabase
      .from('matches')
      .insert({
        guild_id: guildId,
        player_a: playerA,
        player_b: playerB,
        status: 'open',
        winner: null,
        odds_a: oddsA,
        odds_b: oddsB,
        created_by: message.author.id,
      })
      .select()
      .single();

    if (error) throw error;

    const embed = new (require('discord.js').EmbedBuilder)()
      .setColor(0x00FF00)
      .setTitle('🎲 Live Match Dashboard')
      .setDescription(`🏆 **Match #${match.id}** is now open for betting! Click the buttons below or type the command to place your support.`)
      .addFields(
        { name: `🟦 ${playerA}`, value: oddsA ? `📈 **${oddsA.toFixed(2)}x**` : '\u200b', inline: true },
        { name: '\u200b', value: '**VS**', inline: true },
        { name: `🟥 ${playerB}`, value: oddsB ? `📈 **${oddsB.toFixed(2)}x**` : '\u200b', inline: true }
      )
      .setFooter({ text: `Mochi Match System` })
      .setTimestamp();

    const buttonLabelA = oddsA ? `${oddsA.toFixed(2)} (1)` : `Bet ${playerA}`;
    const buttonLabelB = oddsB ? `${oddsB.toFixed(2)} (2)` : `Bet ${playerB}`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bet_a_${match.id}`)
        .setLabel(buttonLabelA)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`bet_b_${match.id}`)
        .setLabel(buttonLabelB)
        .setStyle(ButtonStyle.Danger)
    );

    await message.reply({ embeds: [embed], components: [row] });
  },

  // ─── matches ───
  async matches(message, args, guildId) {
    let page = parseInt(args[0]) || 1;
    if (page < 1) page = 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    // Get total count of open matches
    const { count, error: countError } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .eq('status', 'open');

    if (countError) throw countError;
    const totalPages = Math.ceil((count || 0) / limit) || 1;

    const { data: matches, error } = await supabase
      .from('matches')
      .select('*')
      .eq('guild_id', guildId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    if (!matches || matches.length === 0) {
      await message.reply({ embeds: [embeds.info('No Matches', 'There are no open matches right now on this page.', message.author)] });
      return;
    }

    const entries = matches.map((m) => {
      const oddsText = m.odds_a && m.odds_b ? `\n🟩 **${m.odds_a}x** (1)  |  🟥 **${m.odds_b}x** (2)` : '';
      return `**Match #${m.id}**\n🏴󠁧󠁢󠁥󠁮󠁧󠁿 **${m.player_a}** vs 🇳🇿 **${m.player_b}**${oddsText}\n───────────────────`;
    });

    const embed = embeds.betting(
      `🎲 Open Matches (Page ${page}/${totalPages})`,
      entries.join('\n') + '\nUse `mochi matchinfo <id>` for details.'
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── matchinfo ───
  async matchinfo(message, args, guildId) {
    const matchId = parseInt(args[0]);
    if (isNaN(matchId)) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi matchinfo <match id>`')] });
      return;
    }

    const { data: match, error } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .eq('guild_id', guildId)
      .single();

    if (error || !match) {
      await message.reply({ embeds: [embeds.error('Not Found', `Match #${matchId} not found.`)] });
      return;
    }

    // Get bet statistics
    const { data: bets } = await supabase
      .from('match_bets')
      .select('*')
      .eq('match_id', matchId)
      .eq('guild_id', guildId);

    const betsOnA = bets?.filter((b) => b.supported.toLowerCase() === match.player_a.toLowerCase()) || [];
    const betsOnB = bets?.filter((b) => b.supported.toLowerCase() === match.player_b.toLowerCase()) || [];
    
    const totalA = betsOnA.reduce((sum, b) => sum + b.amount, 0);
    const totalB = betsOnB.reduce((sum, b) => sum + b.amount, 0);
    const totalPool = totalA + totalB;

    const embed = new (require('discord.js').EmbedBuilder)()
      .setColor(0x00FF00)
      .setTitle(`📊 Match #${match.id} Details`)
      .setDescription(`Status: **${match.status.toUpperCase()}**${match.winner ? `\nWinner: **${match.winner}**` : ''}`)
      .addFields(
        { name: `🟦 ${match.player_a}`, value: `Bets: **${betsOnA.length}**\nTotal: **${totalA.toLocaleString()}** coins\nOdds: **${match.odds_a ? match.odds_a + 'x' : 'Dynamic'}**`, inline: true },
        { name: `🟥 ${match.player_b}`, value: `Bets: **${betsOnB.length}**\nTotal: **${totalB.toLocaleString()}** coins\nOdds: **${match.odds_b ? match.odds_b + 'x' : 'Dynamic'}**`, inline: true },
        { name: '💰 Total Pool', value: `**${totalPool.toLocaleString()}** coins`, inline: true }
      )
      .setFooter({ text: 'Mochi Match System' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  },

  // ─── support ───
  async support(message, args, guildId) {
    if (args.length < 2) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi support <PlayerName> <amount>`')] });
      return;
    }

    const amount = parseInt(args[args.length - 1]);
    const playerName = args.slice(0, -1).join(' ');

    if (isNaN(amount) || amount <= 0) {
      await message.reply({ embeds: [embeds.error('Invalid Amount', 'Please provide a valid positive number.')] });
      return;
    }

    // Find the match where this player is competing and status is open
    const { data: matches } = await supabase
      .from('matches')
      .select('*')
      .eq('guild_id', guildId)
      .eq('status', 'open')
      .or(`player_a.ilike.${playerName},player_b.ilike.${playerName}`);

    if (!matches || matches.length === 0) {
      await message.reply({ embeds: [embeds.error('No Active Match', `No open match found with player "${playerName}".`)] });
      return;
    }

    // Use the most recent match
    const match = matches[0];

    // Validate the player name matches one of the competitors
    const isPlayerA = match.player_a.toLowerCase() === playerName.toLowerCase();
    const isPlayerB = match.player_b.toLowerCase() === playerName.toLowerCase();
    
    if (!isPlayerA && !isPlayerB) {
      await message.reply({ embeds: [embeds.error('Invalid Player', `**${playerName}** is not competing in Match #${match.id}. The competitors are **${match.player_a}** and **${match.player_b}**.`)] });
      return;
    }

    const supportedPlayer = isPlayerA ? match.player_a : match.player_b;

    // Check if user already placed a bet on this match
    const { data: existingBet } = await supabase
      .from('match_bets')
      .select('id')
      .eq('match_id', match.id)
      .eq('user_id', message.author.id)
      .single();

    if (existingBet) {
      await message.reply({ embeds: [embeds.error('Already Bet', 'You have already placed a bet on this match. Only one bet per match is allowed.')] });
      return;
    }

    // Check wallet balance
    const balance = await getBalance(message.author.id, guildId);
    if (balance < amount) {
      await message.reply({ embeds: [embeds.error('Insufficient Funds', `You only have **${balance.toLocaleString()}** Mochi Coins. This bet requires **${amount.toLocaleString()}** coins.`)] });
      return;
    }

    // Deduct coins from wallet (lock them)
    await debit(message.author.id, guildId, amount, 'match_bet', `Bet on ${supportedPlayer} in Match #${match.id}`);

    // Record the bet
    const { error: betError } = await supabase
      .from('match_bets')
      .insert({
        match_id: match.id,
        guild_id: guildId,
        user_id: message.author.id,
        supported: supportedPlayer,
        amount: amount,
      });

    if (betError) {
      // Refund on error
      await credit(message.author.id, guildId, amount, 'bet_refund', `Refund for failed bet on Match #${match.id}`);
      throw betError;
    }

    const embed = embeds.success(
      'Bet Placed! 🎲',
      `You bet **${amount.toLocaleString()}** coins on **${supportedPlayer}** in Match #${match.id}!\nGood luck! 🍀`
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── endmatch (admin) ───
  async endmatch(message, args, guildId) {
    if (!isAdmin(message.member)) {
      await message.reply({ embeds: [embeds.error('Admin Only', 'You need **Administrator** permission to use this command.')] });
      return;
    }

    if (args.length < 2) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi endmatch <match id> <WinnerName>`')] });
      return;
    }

    const matchId = parseInt(args[0]);
    const winnerName = args.slice(1).join(' ');

    if (isNaN(matchId)) {
      await message.reply({ embeds: [embeds.error('Invalid ID', 'Match ID must be a number.')] });
      return;
    }

    // Get the match
    const { data: match, error } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .eq('guild_id', guildId)
      .eq('status', 'open')
      .single();

    if (error || !match) {
      await message.reply({ embeds: [embeds.error('Not Found', `Open match #${matchId} not found.`)] });
      return;
    }

    // Validate winner name
    const winnerA = match.player_a.toLowerCase() === winnerName.toLowerCase();
    const winnerB = match.player_b.toLowerCase() === winnerName.toLowerCase();
    
    if (!winnerA && !winnerB) {
      await message.reply({ embeds: [embeds.error('Invalid Winner', `**${winnerName}** is not a competitor in Match #${matchId}. The competitors are **${match.player_a}** and **${match.player_b}**.`)] });
      return;
    }

    const actualWinner = winnerA ? match.player_a : match.player_b;

    // Get all bets for this match
    const { data: bets } = await supabase
      .from('match_bets')
      .select('*')
      .eq('match_id', matchId)
      .eq('guild_id', guildId);

    const totalPool = bets?.reduce((sum, b) => sum + b.amount, 0) || 0;
    const winningBets = bets?.filter((b) => b.supported.toLowerCase() === actualWinner.toLowerCase()) || [];
    const totalWinningAmount = winningBets.reduce((sum, b) => sum + b.amount, 0);

    // Close the match
    const { error: updateError } = await supabase
      .from('matches')
      .update({ status: 'closed', winner: actualWinner })
      .eq('id', matchId);

    if (updateError) throw updateError;

    // Distribute winnings
    const hasFixedOdds = match.odds_a && match.odds_b;
    const winningOdds = winnerA ? parseFloat(match.odds_a) : parseFloat(match.odds_b);

    if (winningBets.length > 0) {
      for (const bet of winningBets) {
        let share;
        let payoutNote;
        
        if (hasFixedOdds) {
          // Fixed odds payout (multiplier * bet)
          share = Math.floor(bet.amount * winningOdds);
          payoutNote = `Won bet on Match #${matchId} — ${actualWinner} won! (Odds: ${winningOdds}x, Bet: ${bet.amount}, Return: ${share})`;
        } else {
          // Proportional payout based on the bet size relative to total winning bets pool
          share = Math.floor((bet.amount / totalWinningAmount) * totalPool);
          payoutNote = `Won bet on Match #${matchId} — ${actualWinner} won! (Bet: ${bet.amount}, Won: ${share})`;
        }
        
        await credit(
          bet.user_id,
          guildId,
          share,
          'match_win',
          payoutNote
        );
      }
    }

    const payoutTypeDesc = hasFixedOdds 
      ? `Winnings distributed based on set odds: **${winningOdds}x**!`
      : `Winnings distributed proportionally to the winners' bet amounts!`;

    const embed = embeds.success(
      'Match Ended! 🏆',
      `Match #${match.id}: **${match.player_a}** vs **${match.player_b}**\n**Winner: ${actualWinner}**\n\n💰 **${totalPool.toLocaleString()}** coins in the pool\n🏅 **${winningBets.length}** winning bet(s)\n${winningBets.length > 0 ? payoutTypeDesc : 'No winners — all bets were on the losing side.'}`
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── cancelmatch (admin) ───
  async cancelmatch(message, args, guildId) {
    if (!isAdmin(message.member)) {
      await message.reply({ embeds: [embeds.error('Admin Only', 'You need **Administrator** permission to use this command.')] });
      return;
    }

    const matchId = parseInt(args[0]);
    if (isNaN(matchId)) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi cancelmatch <match id>`')] });
      return;
    }

    // Get the match
    const { data: match, error } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .eq('guild_id', guildId)
      .eq('status', 'open')
      .single();

    if (error || !match) {
      await message.reply({ embeds: [embeds.error('Not Found', `Open match #${matchId} not found.`)] });
      return;
    }

    // Get all bets to refund
    const { data: bets } = await supabase
      .from('match_bets')
      .select('*')
      .eq('match_id', matchId)
      .eq('guild_id', guildId);

    // Refund all bets
    let totalRefunded = 0;
    if (bets && bets.length > 0) {
      for (const bet of bets) {
        await credit(
          bet.user_id,
          guildId,
          bet.amount,
          'match_cancel_refund',
          `Refund for cancelled Match #${matchId}`
        );
        totalRefunded += bet.amount;
      }
    }

    // Mark match as cancelled
    const { error: updateError } = await supabase
      .from('matches')
      .update({ status: 'cancelled', winner: null })
      .eq('id', matchId);

    if (updateError) throw updateError;

    const embed = embeds.warning(
      'Match Cancelled ⛔',
      `Match #${match.id}: **${match.player_a}** vs **${match.player_b}** has been cancelled.\n\n${bets?.length > 0 ? `💰 Refunded **${totalRefunded.toLocaleString()}** coins to **${bets.length}** bet(s).` : 'No bets to refund.'}`
    );
    await message.reply({ embeds: [embed] });
  },
};

module.exports = bettingCommands;
