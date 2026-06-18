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
    let playerA, playerB;

    if (vsIndex !== -1) {
      playerA = args.slice(0, vsIndex).join(' ');
      playerB = args.slice(vsIndex + 1).join(' ');
    } else {
      // Fallback: PlayerB is last word, PlayerA is rest
      playerB = args[args.length - 1];
      playerA = args.slice(0, -1).join(' ');
    }

    if (!playerA || !playerB) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi creatematch <PlayerA> <PlayerB>`')] });
      return;
    }

    if (playerA.toLowerCase() === playerB.toLowerCase()) {
      await message.reply({ embeds: [embeds.error('Invalid Match', 'A player cannot compete against themselves!')] });
      return;
    }

    const { data: match, error } = await supabase
      .from('matches')
      .insert({
        guild_id: guildId,
        player_a: playerA,
        player_b: playerB,
        status: 'open',
        winner: null,
        created_by: message.author.id,
      })
      .select()
      .single();

    if (error) throw error;

    const embed = embeds.betting(
      '🔥 New Match Created!',
      `**Match #${match.id}**\n🟦 **${playerA}** vs 🟥 **${playerB}**\n\nPlace your bets with \`mochi support ${playerA} <amount>\` or \`mochi support ${playerB} <amount>\``
    );
    await message.reply({ embeds: [embed] });
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

    const entries = matches.map((m) => `**#${m.id}** — 🟦 **${m.player_a}** vs 🟥 **${m.player_b}**`);

    const embed = embeds.betting(
      `🎲 Open Matches (Page ${page}/${totalPages})`,
      entries.join('\n') + '\n\nUse `mochi matchinfo <id>` for details.\n*Use `mochi matches <page>` to view other pages.*'
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

    const embed = embeds.betting(
      `📊 Match #${match.id} Info`,
      `🟦 **${match.player_a}** vs 🟥 **${match.player_b}**\nStatus: **${match.status.toUpperCase()}**${match.winner ? `\nWinner: **${match.winner}**` : ''}`
    );

    embed.addFields(
      { name: `🟦 ${match.player_a}`, value: `Bets: **${betsOnA.length}**\nTotal: **${totalA.toLocaleString()}** coins`, inline: true },
      { name: `🟥 ${match.player_b}`, value: `Bets: **${betsOnB.length}**\nTotal: **${totalB.toLocaleString()}** coins`, inline: true },
      { name: '💰 Total Pool', value: `**${totalPool.toLocaleString()}** coins`, inline: true }
    );

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
    if (winningBets.length > 0 && totalPool > 0) {
      for (const bet of winningBets) {
        // Proportional payout based on the bet size relative to total winning bets pool
        const share = Math.floor((bet.amount / totalWinningAmount) * totalPool);
        
        await credit(
          bet.user_id,
          guildId,
          share,
          'match_win',
          `Won bet on Match #${matchId} — ${actualWinner} won! (Bet: ${bet.amount}, Won: ${share})`
        );
      }
    }

    const embed = embeds.success(
      'Match Ended! 🏆',
      `Match #${match.id}: **${match.player_a}** vs **${match.player_b}**\n**Winner: ${actualWinner}**\n\n💰 **${totalPool.toLocaleString()}** coins in the pool\n🏅 **${winningBets.length}** winning bet(s)\n${winningBets.length > 0 ? `Winnings have been distributed proportionally to the winners' bet amounts!` : 'No winners — all bets were on the losing side.'}`
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
