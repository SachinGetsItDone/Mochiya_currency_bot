const { supabase } = require('../utils/supabase');
const { isAdmin } = require('../utils/permissions');
const embeds = require('../utils/embeds');

const tournamentCommands = {
  // ─── setbudget (admin) ───
  async setbudget(message, args, guildId) {
    if (!isAdmin(message.member)) {
      await message.reply({ embeds: [embeds.error('Admin Only', 'You need **Administrator** permission to use this command.')] });
      return;
    }

    const target = message.mentions.users.first();
    const amount = parseInt(args[1]);

    if (!target) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi setbudget @user <amount>`')] });
      return;
    }
    if (isNaN(amount) || amount < 0) {
      await message.reply({ embeds: [embeds.error('Invalid Amount', 'Please provide a valid non-negative number.')] });
      return;
    }

    // Check if budget exists
    const { data: existingBudget } = await supabase
      .from('budgets')
      .select('id, spent')
      .eq('user_id', target.id)
      .eq('guild_id', guildId)
      .single();

    if (existingBudget) {
      // Update only total
      const { error } = await supabase
        .from('budgets')
        .update({ total: amount })
        .eq('id', existingBudget.id);
      
      if (error) throw error;
    } else {
      // Insert new
      const { error } = await supabase
        .from('budgets')
        .insert({
          user_id: target.id,
          guild_id: guildId,
          total: amount,
          spent: 0
        });
      
      if (error) throw error;
    }

    const embed = embeds.success(
      'Budget Set! 💰',
      `Set **${target.username}**'s tournament budget to **${amount.toLocaleString()}** coins.`
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── budget ───
  async budget(message, args, guildId) {
    const { data, error } = await supabase
      .from('budgets')
      .select('total, spent')
      .eq('user_id', message.author.id)
      .eq('guild_id', guildId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    if (!data) {
      await message.reply({ embeds: [embeds.info('No Budget', 'You do not have a tournament budget yet. An admin can set one with `mochi setbudget`.', message.author)] });
      return;
    }

    const remaining = data.total - data.spent;
    const embed = embeds.tournament(
      '📊 Your Tournament Budget',
      `**Total:** ${data.total.toLocaleString()} coins\n**Spent:** ${data.spent.toLocaleString()} coins\n**Remaining:** **${remaining.toLocaleString()}** coins`,
      message.author
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── addplayer (admin) ───
  async addplayer(message, args, guildId) {
    if (!isAdmin(message.member)) {
      await message.reply({ embeds: [embeds.error('Admin Only', 'You need **Administrator** permission to use this command.')] });
      return;
    }

    // Parse: mochi addplayer <name> <price>
    // Name can be multi-word, price is the last arg
    if (args.length < 2) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi addplayer <name> <price>`')] });
      return;
    }

    const price = parseInt(args[args.length - 1]);
    const name = args.slice(0, -1).join(' ');

    if (isNaN(price) || price < 0) {
      await message.reply({ embeds: [embeds.error('Invalid Price', 'Please provide a valid non-negative price.')] });
      return;
    }
    if (!name || name.length > 50) {
      await message.reply({ embeds: [embeds.error('Invalid Name', 'Player name must be 1-50 characters.')] });
      return;
    }

    // Check if player with same name exists in this guild
    const { data: existing } = await supabase
      .from('players')
      .select('id')
      .eq('guild_id', guildId)
      .ilike('name', name)
      .is('owner_id', null)
      .single();

    if (existing) {
      await message.reply({ embeds: [embeds.error('Player Exists', `A player named "${name}" is already in the pool.`)] });
      return;
    }

    const { error } = await supabase
      .from('players')
      .insert({ guild_id: guildId, name, price, owner_id: null });

    if (error) throw error;

    const embed = embeds.success(
      'Player Added! ⚽',
      `Added **${name}** to the player pool for **${price.toLocaleString()}** coins.`
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── players ───
  async players(message, args, guildId) {
    let page = parseInt(args[0]) || 1;
    if (page < 1) page = 1;
    const limit = 15;
    const offset = (page - 1) * limit;

    // Get total count of players
    const { count, error: countError } = await supabase
      .from('players')
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .is('owner_id', null);

    if (countError) throw countError;
    const totalPages = Math.ceil((count || 0) / limit) || 1;

    const { data: players, error } = await supabase
      .from('players')
      .select('*')
      .eq('guild_id', guildId)
      .is('owner_id', null)
      .order('price', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    if (!players || players.length === 0) {
      await message.reply({ embeds: [embeds.info('No Players', 'There are no available players on this page.', message.author)] });
      return;
    }

    const entries = players.map((p) => `• **${p.name}** — ${p.price.toLocaleString()} coins`);

    const embed = embeds.tournament(
      `⚽ Available Players (Page ${page}/${totalPages})`,
      entries.join('\n') + `\n\n*Use \`mochi players <page>\` to view other pages.*`
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── buy ───
  async buy(message, args, guildId) {
    if (args.length < 1) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi buy <playername>`')] });
      return;
    }

    const playerName = args.join(' ');

    // Find the player (case-insensitive)
    const { data: player } = await supabase
      .from('players')
      .select('*')
      .eq('guild_id', guildId)
      .ilike('name', playerName)
      .is('owner_id', null)
      .single();

    if (!player) {
      await message.reply({ embeds: [embeds.error('Not Found', `No available player named "${playerName}". Use \`mochi players\` to see available players.`)] });
      return;
    }

    // Call the atomic RPC to handle the purchase securely
    const { error: rpcError } = await supabase.rpc('buy_tournament_player', {
      p_user_id: message.author.id,
      p_guild_id: guildId,
      p_player_id: player.id,
      p_price: player.price
    });

    if (rpcError) {
       let errorMsg = 'An error occurred during purchase.';
       if (rpcError.message.includes('already been bought')) {
          errorMsg = `Sorry, someone else just bought **${player.name}**!`;
       } else if (rpcError.message.includes('Insufficient tournament budget')) {
          errorMsg = `You don't have enough budget. **${player.name}** costs **${player.price.toLocaleString()}** coins.`;
       } else if (rpcError.message.includes('No tournament budget')) {
          errorMsg = `You do not have a tournament budget. Ask an admin to set one.`;
       }
       await message.reply({ embeds: [embeds.error('Purchase Failed', errorMsg)] });
       return;
    }

    // Fetch updated budget for the success message
    const { data: newBudget } = await supabase
      .from('budgets')
      .select('total, spent')
      .eq('user_id', message.author.id)
      .eq('guild_id', guildId)
      .single();

    const remaining = newBudget ? newBudget.total - newBudget.spent : 0;

    const embed = embeds.success(
      'Player Purchased! ⚽',
      `You bought **${player.name}** for **${player.price.toLocaleString()}** coins!\nBudget remaining: **${remaining.toLocaleString()}** coins`
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── roster ───
  async roster(message, args, guildId) {
    const target = message.mentions.users.first() || message.author;

    const { data: players, error } = await supabase
      .from('players')
      .select('*')
      .eq('guild_id', guildId)
      .eq('owner_id', target.id)
      .order('price', { ascending: false });

    if (error) throw error;

    if (!players || players.length === 0) {
      const msg = target.id === message.author.id
        ? 'Your roster is empty. Buy players with `mochi buy <playername>`.'
        : `**${target.username}**'s roster is empty.`;
      await message.reply({ embeds: [embeds.info('Empty Roster', msg, target)] });
      return;
    }

    const entries = players.map((p) => `• **${p.name}** — ${p.price.toLocaleString()} coins`);
    const totalValue = players.reduce((sum, p) => sum + p.price, 0);

    const embed = embeds.tournament(
      `${target.id === message.author.id ? 'Your' : target.username + '\'s'} Roster (${players.length})`,
      `${entries.join('\n')}\n\n**Total Value:** ${totalValue.toLocaleString()} coins`,
      target
    );
    await message.reply({ embeds: [embed] });
  },
};

module.exports = tournamentCommands;
