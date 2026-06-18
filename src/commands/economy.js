const { EmbedBuilder } = require('discord.js');
const { supabase } = require('../utils/supabase');
const { getBalance, credit, debit, transfer, ensureWallet } = require('../utils/wallet');
const { isAdmin } = require('../utils/permissions');
const embeds = require('../utils/embeds');

const DAILY_REWARD = 100;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

const economyCommands = {
  // ─── cash ───
  async cash(message, args, guildId) {
    const target = message.author;
    const balance = await getBalance(target.id, guildId);
    
    const embed = embeds.economy(
      '💰 Mochi Coin Balance',
      `You have **${balance.toLocaleString()}** Mochi Coins 🪙`,
      target
    );
    
    await message.reply({ embeds: [embed] });
  },

  // ─── daily ───
  async daily(message, args, guildId) {
    const userId = message.author.id;
    await ensureWallet(userId, guildId);

    const { data: wallet } = await supabase
      .from('wallets')
      .select('last_daily')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();

    const now = new Date();
    const lastDaily = wallet?.last_daily ? new Date(wallet.last_daily) : null;

    if (lastDaily) {
      const timeSinceLast = now - lastDaily;
      if (timeSinceLast < DAILY_COOLDOWN_MS) {
        const remainingMs = DAILY_COOLDOWN_MS - timeSinceLast;
        const hours = Math.floor(remainingMs / (1000 * 60 * 60));
        const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
        
        const embed = embeds.warning(
          'Daily Reward on Cooldown',
          `You've already claimed your daily reward.\nCome back in **${hours}h ${minutes}m**.`
        );
        await message.reply({ embeds: [embed] });
        return;
      }
    }

    // Update last_daily and credit
    await supabase
      .from('wallets')
      .update({ last_daily: now.toISOString() })
      .eq('user_id', userId)
      .eq('guild_id', guildId);

    const newBalance = await credit(userId, guildId, DAILY_REWARD, 'daily', 'Daily reward claim');

    const embed = embeds.success(
      'Daily Reward Claimed! 🎉',
      `You received **${DAILY_REWARD}** Mochi Coins!\nNew balance: **${newBalance.toLocaleString()}** 🪙`,
      message.author
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── pay ───
  async pay(message, args, guildId) {
    const target = message.mentions.users.first();
    const amount = parseInt(args[1]);

    if (!target) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi pay @user <amount>`')] });
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      await message.reply({ embeds: [embeds.error('Invalid Amount', 'Please provide a valid positive number.')] });
      return;
    }
    if (target.id === message.author.id) {
      await message.reply({ embeds: [embeds.error('Nice Try', 'You cannot pay yourself!')] });
      return;
    }
    if (target.bot) {
      await message.reply({ embeds: [embeds.error('Invalid Target', 'You cannot pay a bot!')] });
      return;
    }

    const senderBalance = await getBalance(message.author.id, guildId);
    if (senderBalance < amount) {
      await message.reply({ embeds: [embeds.error('Insufficient Funds', `You only have **${senderBalance.toLocaleString()}** Mochi Coins.`)] });
      return;
    }

    await transfer(message.author.id, target.id, guildId, amount, `Payment to ${target.username}`);

    const embed = embeds.success(
      'Payment Sent! 💸',
      `You paid **${amount.toLocaleString()}** Mochi Coins to **${target.username}**!`,
      message.author
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── give (admin) ───
  async give(message, args, guildId) {
    if (!isAdmin(message.member)) {
      await message.reply({ embeds: [embeds.error('Admin Only', 'You need **Administrator** permission to use this command.')] });
      return;
    }

    const target = message.mentions.users.first();
    const amount = parseInt(args[1]);

    if (!target) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi give @user <amount>`')] });
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      await message.reply({ embeds: [embeds.error('Invalid Amount', 'Please provide a valid positive number.')] });
      return;
    }

    const newBalance = await credit(target.id, guildId, amount, 'admin_give', `Granted by admin ${message.author.tag}`);

    const embed = embeds.success(
      'Coins Granted ✨',
      `Granted **${amount.toLocaleString()}** Mochi Coins to **${target.username}**.\nTheir new balance: **${newBalance.toLocaleString()}** 🪙`,
      target
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── top ───
  async top(message, args, guildId) {
    let page = parseInt(args[0]) || 1;
    if (page < 1) page = 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    // Get total count of wallets to calculate pages
    const { count, error: countError } = await supabase
      .from('wallets')
      .select('user_id', { count: 'exact', head: true })
      .eq('guild_id', guildId);

    if (countError) throw countError;
    const totalPages = Math.ceil((count || 0) / limit) || 1;

    const { data: wallets, error } = await supabase
      .from('wallets')
      .select('user_id, balance')
      .eq('guild_id', guildId)
      .order('balance', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    if (!wallets || wallets.length === 0) {
      await message.reply({ embeds: [embeds.info('Leaderboard', 'No one has any Mochi Coins on this page!')] });
      return;
    }

    // Fetch usernames
    const leaderboardEntries = await Promise.all(
      wallets.map(async (w, index) => {
        const globalIndex = offset + index;
        try {
          const member = await message.guild.members.fetch(w.user_id);
          const medal = globalIndex === 0 ? '🥇' : globalIndex === 1 ? '🥈' : globalIndex === 2 ? '🥉' : '▫️';
          return `${medal} **#${globalIndex + 1}** — ${member.user.username}: **${w.balance.toLocaleString()}** 🪙`;
        } catch {
          const medal = globalIndex === 0 ? '🥇' : globalIndex === 1 ? '🥈' : globalIndex === 2 ? '🥉' : '▫️';
          return `${medal} **#${globalIndex + 1}** — <@${w.user_id}>: **${w.balance.toLocaleString()}** 🪙`;
        }
      })
    );

    const embed = embeds.economy(
      `🏆 Top Mochi Coin Balances (Page ${page}/${totalPages})`,
      leaderboardEntries.join('\n') + `\n\n*Use \`mochi top <page>\` to view other pages.*`
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── history ───
  async history(message, args, guildId) {
    let page = parseInt(args[0]) || 1;
    if (page < 1) page = 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    // Get total count of transactions
    const { count, error: countError } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .or(`from_user.eq.${message.author.id},to_user.eq.${message.author.id}`);

    if (countError) throw countError;
    const totalPages = Math.ceil((count || 0) / limit) || 1;

    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('guild_id', guildId)
      .or(`from_user.eq.${message.author.id},to_user.eq.${message.author.id}`)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    if (!transactions || transactions.length === 0) {
      await message.reply({ embeds: [embeds.info('Transaction History', 'You have no transactions on this page.', message.author)] });
      return;
    }

    const entries = transactions.map((tx) => {
      const isSender = tx.from_user === message.author.id;
      const arrow = isSender ? '🔴' : '🟢';
      const otherParty = isSender
        ? tx.to_user ? `<@${tx.to_user}>` : 'System'
        : tx.from_user ? `<@${tx.from_user}>` : 'System';
      const date = new Date(tx.created_at).toLocaleDateString();
      return `${arrow} **${tx.amount.toLocaleString()}** coins — ${tx.type} (${otherParty}) — *${date}*`;
    });

    const embed = embeds.info(
      `📜 Transaction History (Page ${page}/${totalPages})`,
      entries.join('\n') + `\n\n*Use \`mochi history <page>\` to view other pages.*`,
      message.author
    );
    await message.reply({ embeds: [embed] });
  },
};

module.exports = economyCommands;
