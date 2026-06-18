const { supabase } = require('../utils/supabase');
const { getBalance, debit } = require('../utils/wallet');
const { isAdmin, canManageRole } = require('../utils/permissions');
const embeds = require('../utils/embeds');
const config = require('../config');

const RARITY_ORDER = { 'common': 1, 'rare': 2, 'epic': 3, 'legendary': 4 };

/**
 * Get available shop items (not expired, in stock) for a guild
 */
async function getAvailableItems(guildId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('shop_items')
    .select('*')
    .eq('guild_id', guildId)
    .eq('is_active', true)
    .gt('stock_remaining', 0)
    .gt('expiry_date', now)
    .order('price', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Check if user owns an item
 */
async function userOwnsItem(userId, guildId, itemId) {
  const { data, error } = await supabase
    .from('user_inventory')
    .select('id')
    .eq('user_id', userId)
    .eq('guild_id', guildId)
    .eq('item_id', itemId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return !!data;
}

const shopCommands = {
  // ─── shop ───
  async shop(message, args, guildId) {
    let page = parseInt(args[0]) || 1;
    if (page < 1) page = 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    const allItems = await getAvailableItems(guildId);
    const totalPages = Math.ceil(allItems.length / limit) || 1;
    const items = allItems.slice(offset, offset + limit);

    if (items.length === 0) {
      await message.reply({ embeds: [embeds.shop('Season Shop', '📭 The shop is currently empty on this page.', message.author)] });
      return;
    }

    const entries = items.map((item) => {
      const daysLeft = Math.ceil((new Date(item.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
      const typeIcon = item.type === 'role' ? '👑' : '🎁';
      const rarityIcon = { 'common': '⚪', 'rare': '🔵', 'epic': '🟣', 'legendary': '🟠' }[item.rarity?.toLowerCase()] || '⚪';
      return `${rarityIcon} ${typeIcon} **${item.name}** — ${item.price.toLocaleString()} coins | Stock: **${item.stock_remaining}** | ${daysLeft}d left`;
    });

    const embed = embeds.shop(
      `🛒 Season Shop (Page ${page}/${totalPages})`,
      entries.join('\n') + `\n\n*Use \`mochi shop <page>\` to view other pages.*`,
      message.author
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── shopbuy ───
  async shopbuy(message, args, guildId) {
    if (args.length < 1) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi shopbuy <item name>`')] });
      return;
    }

    const itemName = args.join(' ');
    const items = await getAvailableItems(guildId);
    const item = items.find((i) => i.name.toLowerCase() === itemName.toLowerCase());

    if (!item) {
      await message.reply({ embeds: [embeds.error('Not Available', `"${itemName}" is not available. Use \`mochi shop\` to browse available items.`)] });
      return;
    }

    // Check if user already owns this item
    if (await userOwnsItem(message.author.id, guildId, item.id)) {
      await message.reply({ embeds: [embeds.error('Already Owned', `You already own **${item.name}**. You can only have one of each item.`)] });
      return;
    }

    // Check wallet balance
    const balance = await getBalance(message.author.id, guildId);
    if (balance < item.price) {
      await message.reply({ embeds: [embeds.error('Insufficient Funds', `**${item.name}** costs **${item.price.toLocaleString()}** coins. You only have **${balance.toLocaleString()}** coins.`)] });
      return;
    }

    // If role type, verify bot can assign it
    if (item.type === 'role' && item.role_id) {
      const check = canManageRole(message.guild, item.role_id);
      if (!check.canManage) {
        await message.reply({ embeds: [embeds.error('Role Error', check.reason)] });
        return;
      }
    }

    // Deduct coins
    await debit(message.author.id, guildId, item.price, 'shop_purchase', `Bought ${item.name}`);

    // Decrease stock
    const { error: stockError } = await supabase
      .from('shop_items')
      .update({ stock_remaining: item.stock_remaining - 1 })
      .eq('id', item.id);

    if (stockError) throw stockError;

    // Add to inventory
    const { error: invError } = await supabase
      .from('user_inventory')
      .insert({
        guild_id: guildId,
        user_id: message.author.id,
        item_id: item.id,
        season_label: item.season_label,
      });

    if (invError) throw invError;

    // If role type, assign the role
    if (item.type === 'role' && item.role_id) {
      try {
        const member = await message.guild.members.fetch(message.author.id);
        await member.roles.add(item.role_id);
      } catch (err) {
        console.error('Failed to assign role:', err);
      }
    }

    const embed = embeds.success(
      'Item Purchased! 🛍️',
      `You bought **${item.name}** for **${item.price.toLocaleString()}** coins!\n${item.type === 'role' ? '👑 The role has been assigned to you!' : '🎁 Added to your collection!'}`
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── collection / flex ───
  async collection(message, args, guildId) {
    const target = message.mentions.users.first() || message.author;
    let page = parseInt(args.filter(a => !a.includes(target.id))[0]) || 1;
    if (page < 1) page = 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    const { data: inventory, error } = await supabase
      .from('user_inventory')
      .select('*, shop_items(*)')
      .eq('user_id', target.id)
      .eq('guild_id', guildId);

    if (error) throw error;

    if (!inventory || inventory.length === 0) {
      const msg = target.id === message.author.id
        ? 'Your collection is empty. Visit the shop with `mochi shop`!'
        : `**${target.username}**'s collection is empty.`;
      await message.reply({ embeds: [embeds.collection('Empty Collection', [{ name: '...', value: msg }], target)] });
      return;
    }

    // Sort by rarity
    inventory.sort((a, b) => (RARITY_ORDER[b.shop_items.rarity?.toLowerCase()] || 0) - (RARITY_ORDER[a.shop_items.rarity?.toLowerCase()] || 0));

    const totalPages = Math.ceil(inventory.length / limit) || 1;
    const paginatedInventory = inventory.slice(offset, offset + limit);

    if (paginatedInventory.length === 0) {
      await message.reply({ embeds: [embeds.collection('Empty Collection', [{ name: '...', value: 'No items on this page.' }], target)] });
      return;
    }

    const fields = paginatedInventory.map((inv) => {
      const rarityIcon = { 'common': '⚪', 'rare': '🔵', 'epic': '🟣', 'legendary': '🟠' }[inv.shop_items.rarity?.toLowerCase()] || '⚪';
      const typeIcon = inv.shop_items.type === 'role' ? '👑' : '🎁';
      const acquired = new Date(inv.acquired_at).toLocaleDateString();
      return {
        name: `${rarityIcon} ${typeIcon} ${inv.shop_items.name}`,
        value: `Rarity: **${inv.shop_items.rarity}** | Season: **${inv.season_label || 'N/A'}** | Acquired: *${acquired}*`,
        inline: false,
      };
    });

    const embed = embeds.collection(
      `${target.id === message.author.id ? '🏆 Your Collection' : `🏆 ${target.username}'s Collection`} (Page ${page}/${totalPages})`,
      fields,
      target
    );

    // Set embed color based on highest rarity in whole inventory
    const highestRarity = inventory[0]?.shop_items?.rarity?.toLowerCase() || 'common';
    embed.setColor(embeds.getRarityColor(highestRarity));

    await message.reply({ embeds: [embed] });
  },

  // ─── additem (admin) ───
  async additem(message, args, guildId) {
    if (!isAdmin(message.member)) {
      await message.reply({ embeds: [embeds.error('Admin Only', 'You need **Administrator** permission to use this command.')] });
      return;
    }

    // Robust argument parser that automatically extracts multi-word names without requiring quotes!
    // We find the first argument that is a number (the price) and treat everything before it as the name.
    const rawContent = message.content.slice(config.prefix.length + args[0].length + 2).trim(); // content after prefix + command
    
    // Better regex-based parser to handle quotes if present, or split by spaces
    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    const parsedArgs = [];
    let match;
    while ((match = regex.exec(rawContent)) !== null) {
      parsedArgs.push(match[1] || match[2] || match[0]);
    }

    // Find the first argument that is a number (excluding the first index itself, which must be name)
    let priceIndex = -1;
    for (let i = 1; i < parsedArgs.length; i++) {
      if (!isNaN(parseInt(parsedArgs[i])) && /^\d+$/.test(parsedArgs[i])) {
        priceIndex = i;
        break;
      }
    }

    if (priceIndex === -1 || parsedArgs.length < priceIndex + 5) {
      await message.reply({
        embeds: [embeds.error('Invalid Usage', 'Usage: `mochi additem <name> <price> <stock> <expiry_date (YYYY-MM-DD)> <type (role/collectible)> <rarity (Common/Rare/Epic/Legendary)> <description> [role_id]`')],
      });
      return;
    }

    const name = parsedArgs.slice(0, priceIndex).join(' ');
    const price = parseInt(parsedArgs[priceIndex]);
    const stock = parseInt(parsedArgs[priceIndex + 1]);
    const expiryDate = parsedArgs[priceIndex + 2];
    const type = parsedArgs[priceIndex + 3].toLowerCase();
    const rarity = parsedArgs[priceIndex + 4];
    
    // Rest of arguments after rarity are description & possibly role_id
    const remaining = parsedArgs.slice(priceIndex + 5);
    if (remaining.length === 0) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Please provide a description for the item.')] });
      return;
    }

    // Check if last arg looks like a role ID (17-20 digit snowflake)
    const lastArg = remaining[remaining.length - 1];
    const roleIdMatch = lastArg.match(/^\d{17,20}$/);
    const roleId = (type === 'role' && roleIdMatch) ? lastArg : null;
    
    const descEndIndex = roleId ? remaining.length - 1 : remaining.length;
    const description = remaining.slice(0, descEndIndex).join(' ');

    if (!name || name.length > 50) {
      await message.reply({ embeds: [embeds.error('Invalid Name', 'Item name must be 1-50 characters.')] });
      return;
    }
    if (isNaN(price) || price < 0) {
      await message.reply({ embeds: [embeds.error('Invalid Price', 'Price must be a non-negative number.')] });
      return;
    }
    if (isNaN(stock) || stock < 1) {
      await message.reply({ embeds: [embeds.error('Invalid Stock', 'Stock must be at least 1.')] });
      return;
    }
    if (!['role', 'collectible'].includes(type)) {
      await message.reply({ embeds: [embeds.error('Invalid Type', 'Type must be either **role** or **collectible**.')] });
      return;
    }
    if (!['common', 'rare', 'epic', 'legendary'].includes(rarity.toLowerCase())) {
      await message.reply({ embeds: [embeds.error('Invalid Rarity', 'Rarity must be one of: Common, Rare, Epic, Legendary.')] });
      return;
    }
    
    // Validate date
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(expiryDate)) {
      await message.reply({ embeds: [embeds.error('Invalid Date', 'Date must be in format **YYYY-MM-DD** (e.g., 2025-12-31).')] });
      return;
    }
    const expiryISO = new Date(expiryDate + 'T23:59:59');
    if (isNaN(expiryISO.getTime()) || expiryISO < new Date()) {
      await message.reply({ embeds: [embeds.error('Invalid Date', 'The expiry date must be a valid future date.')] });
      return;
    }

    if (type === 'role' && !roleId) {
      await message.reply({ embeds: [embeds.error('Missing Role ID', 'For role items, provide the Discord role ID at the end of the command.')] });
      return;
    }

    const { error } = await supabase
      .from('shop_items')
      .insert({
        guild_id: guildId,
        name,
        description: description || name,
        price,
        stock,
        stock_remaining: stock,
        expiry_date: expiryISO.toISOString(),
        type,
        role_id: roleId,
        rarity: rarity.charAt(0).toUpperCase() + rarity.slice(1).toLowerCase(),
        season_label: `Season ${new Date().getFullYear()}`,
        created_by: message.author.id,
      });

    if (error) {
      if (error.code === '23505') {
        await message.reply({ embeds: [embeds.error('Duplicate', `An item named "${name}" already exists in this guild.`)] });
        return;
      }
      throw error;
    }

    const typeIcon = type === 'role' ? '👑' : '🎁';
    const embed = embeds.success(
      'Item Added! ✨',
      `${typeIcon} **${name}** added to the shop!\n💰 Price: **${price.toLocaleString()}** coins | Stock: **${stock}**\n📅 Expires: **${expiryDate}** | Rarity: **${rarity}**\n📝 ${description || name}${roleId ? `\n👑 Role: <@&${roleId}>` : ''}`
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── removeitem (admin) ───
  async removeitem(message, args, guildId) {
    if (!isAdmin(message.member)) {
      await message.reply({ embeds: [embeds.error('Admin Only', 'You need **Administrator** permission to use this command.')] });
      return;
    }

    if (args.length < 1) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi removeitem <item name>`')] });
      return;
    }

    const itemName = args.join(' ');

    // Find the item
    const { data: item, error } = await supabase
      .from('shop_items')
      .select('*')
      .eq('guild_id', guildId)
      .ilike('name', itemName)
      .single();

    if (error || !item) {
      await message.reply({ embeds: [embeds.error('Not Found', `Item "${itemName}" not found in the shop.`)] });
      return;
    }

    // Soft-delete the item (ownership records remain)
    const { error: deleteError } = await supabase
      .from('shop_items')
      .update({ is_active: false })
      .eq('id', item.id);

    if (deleteError) throw deleteError;

    const embed = embeds.success(
      'Item Removed ✂️',
      `Removed **${item.name}** from the shop.\n⚠️ Users who already own this item keep it in their collection.`
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── gift ───
  async gift(message, args, guildId) {
    const target = message.mentions.users.first();
    if (!target) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi gift @user <item name>`')] });
      return;
    }

    // Remove mention from args to get item name
    const itemName = args.filter((a) => !a.includes(target.id)).join(' ');
    if (!itemName) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi gift @user <item name>`')] });
      return;
    }

    if (target.id === message.author.id) {
      await message.reply({ embeds: [embeds.error('Nice Try', 'You cannot gift an item to yourself!')] });
      return;
    }
    if (target.bot) {
      await message.reply({ embeds: [embeds.error('Invalid Target', 'You cannot gift items to a bot!')] });
      return;
    }

    // Find the item in user's inventory
    const { data: inventory, error } = await supabase
      .from('user_inventory')
      .select('*, shop_items(*)')
      .eq('user_id', message.author.id)
      .eq('guild_id', guildId)
      .filter('shop_items.name', 'ilike', itemName)
      .single();

    if (error || !inventory) {
      await message.reply({ embeds: [embeds.error('Not Owned', `You do not own an item named "${itemName}".`)] });
      return;
    }

    // Check if receiver already owns this item
    if (await userOwnsItem(target.id, guildId, inventory.item_id)) {
      await message.reply({ embeds: [embeds.error('Already Owned', `**${target.username}** already owns **${inventory.shop_items.name}**.`)] });
      return;
    }

    // Remove from sender's inventory
    const { error: deleteError } = await supabase
      .from('user_inventory')
      .delete()
      .eq('id', inventory.id);

    if (deleteError) throw deleteError;

    // If it's a role, remove from sender and add to receiver
    if (inventory.shop_items.type === 'role' && inventory.shop_items.role_id) {
      try {
        const senderMember = await message.guild.members.fetch(message.author.id);
        await senderMember.roles.remove(inventory.shop_items.role_id);
      } catch (err) {
        console.error('Failed to remove role from sender:', err);
      }

      const check = canManageRole(message.guild, inventory.shop_items.role_id);
      if (check.canManage) {
        try {
          const receiverMember = await message.guild.members.fetch(target.id);
          await receiverMember.roles.add(inventory.shop_items.role_id);
        } catch (err) {
          console.error('Failed to add role to receiver:', err);
        }
      }
    }

    // Add to receiver's inventory
    const { error: insertError } = await supabase
      .from('user_inventory')
      .insert({
        guild_id: guildId,
        user_id: target.id,
        item_id: inventory.item_id,
        season_label: inventory.season_label,
      });

    if (insertError) throw insertError;

    const embed = embeds.success(
      'Item Gifted! 🎁',
      `You gifted **${inventory.shop_items.name}** to **${target.username}**!`
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── trade ───
  async trade(message, args, guildId) {
    // Usage: mochi trade @user <your item> for <their item>
    const target = message.mentions.users.first();
    if (!target) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi trade @user <your item> for <their item>`')] });
      return;
    }

    // Reconstruct the trade string after the mention
    const remainingArgs = args.filter((a) => !a.includes(target.id));
    const tradeStr = remainingArgs.join(' ');
    
    // Parse "your item for their item"
    const forIndex = remainingArgs.findIndex((a) => a.toLowerCase() === 'for');
    if (forIndex === -1) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi trade @user <your item> for <their item>`')] });
      return;
    }

    const yourItemName = remainingArgs.slice(0, forIndex).join(' ');
    const theirItemName = remainingArgs.slice(forIndex + 1).join(' ');

    if (!yourItemName || !theirItemName) {
      await message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `mochi trade @user <your item> for <their item>`')] });
      return;
    }

    if (target.id === message.author.id) {
      await message.reply({ embeds: [embeds.error('Nice Try', 'You cannot trade with yourself!')] });
      return;
    }
    if (target.bot) {
      await message.reply({ embeds: [embeds.error('Invalid Target', 'You cannot trade with a bot!')] });
      return;
    }

    // Clean up expired trades first
    const nowISO = new Date().toISOString();
    await supabase
      .from('active_trades')
      .update({ status: 'declined' })
      .eq('guild_id', guildId)
      .eq('status', 'pending')
      .lt('expires_at', nowISO);

    // Check for existing pending trade between these users
    const { data: existingTrade } = await supabase
      .from('active_trades')
      .select('id')
      .eq('guild_id', guildId)
      .eq('initiator_id', message.author.id)
      .eq('receiver_id', target.id)
      .eq('status', 'pending')
      .single();

    if (existingTrade) {
      await message.reply({ embeds: [embeds.error('Pending Trade', 'You already have a pending trade with this user. Wait for them to respond or cancel it using `mochi tradecancel`.')] });
      return;
    }

    // Find initiator's item
    const { data: yourItem } = await supabase
      .from('user_inventory')
      .select('*, shop_items(*)')
      .eq('user_id', message.author.id)
      .eq('guild_id', guildId)
      .filter('shop_items.name', 'ilike', yourItemName)
      .single();

    if (!yourItem) {
      await message.reply({ embeds: [embeds.error('Not Owned', `You do not own an item named "${yourItemName}".`)] });
      return;
    }

    // Find receiver's item
    const { data: theirItem } = await supabase
      .from('user_inventory')
      .select('*, shop_items(*)')
      .eq('user_id', target.id)
      .eq('guild_id', guildId)
      .filter('shop_items.name', 'ilike', theirItemName)
      .single();

    if (!theirItem) {
      await message.reply({ embeds: [embeds.error('Not Owned', `**${target.username}** does not own an item named "${theirItemName}".`)] });
      return;
    }

    // Check if receiver already owns initiator's item
    if (await userOwnsItem(target.id, guildId, yourItem.item_id)) {
      await message.reply({ embeds: [embeds.error('Duplicate', `**${target.username}** already owns **${yourItem.shop_items.name}**. They cannot receive a duplicate.`)] });
      return;
    }

    // Check if initiator already owns receiver's item
    if (await userOwnsItem(message.author.id, guildId, theirItem.item_id)) {
      await message.reply({ embeds: [embeds.error('Duplicate', `You already own **${theirItem.shop_items.name}**. You cannot receive a duplicate.`)] });
      return;
    }

    // Create trade with 10 minutes expiry
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { data: trade, error } = await supabase
      .from('active_trades')
      .insert({
        guild_id: guildId,
        initiator_id: message.author.id,
        receiver_id: target.id,
        initiator_item_id: yourItem.item_id,
        receiver_item_id: theirItem.item_id,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error) throw error;

    const embed = embeds.info(
      'Trade Proposed 🤝',
      `**${message.author.username}** wants to trade:\n🎁 **${yourItem.shop_items.name}** → for **${theirItem.shop_items.name}** ← 🎁\n\n*This trade offer expires in 10 minutes.*\n\n**${target.username}**, respond with:\n✅ \`mochi tradeaccept\` to accept\n❌ \`mochi tradedecline\` to decline`
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── tradeaccept ───
  async tradeaccept(message, args, guildId) {
    // Find pending trade where user is the receiver
    const { data: trade, error } = await supabase
      .from('active_trades')
      .select('*')
      .eq('guild_id', guildId)
      .eq('receiver_id', message.author.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !trade) {
      await message.reply({ embeds: [embeds.error('No Trade', 'You have no pending trade offers to accept.')] });
      return;
    }

    // Check expiry
    if (new Date() > new Date(trade.expires_at)) {
      await supabase.from('active_trades').update({ status: 'declined' }).eq('id', trade.id);
      await message.reply({ embeds: [embeds.error('Trade Expired', 'This trade offer has expired.')] });
      return;
    }

    // Verify both users still own their items
    const { data: initiatorItem } = await supabase
      .from('user_inventory')
      .select('*, shop_items(*)')
      .eq('user_id', trade.initiator_id)
      .eq('guild_id', guildId)
      .eq('item_id', trade.initiator_item_id)
      .single();

    const { data: receiverItem } = await supabase
      .from('user_inventory')
      .select('*, shop_items(*)')
      .eq('user_id', trade.receiver_id)
      .eq('guild_id', guildId)
      .eq('item_id', trade.receiver_item_id)
      .single();

    if (!initiatorItem || !receiverItem) {
      await supabase.from('active_trades').update({ status: 'declined' }).eq('id', trade.id);
      await message.reply({ embeds: [embeds.error('Trade Failed', 'One of the items is no longer available. The trade has been cancelled.')] });
      return;
    }

    // Check duplicates after swap
    const { data: dupInitiator } = await supabase
      .from('user_inventory')
      .select('id')
      .eq('user_id', trade.initiator_id)
      .eq('guild_id', guildId)
      .eq('item_id', trade.receiver_item_id)
      .single();

    const { data: dupReceiver } = await supabase
      .from('user_inventory')
      .select('id')
      .eq('user_id', trade.receiver_id)
      .eq('guild_id', guildId)
      .eq('item_id', trade.initiator_item_id)
      .single();

    if (dupInitiator || dupReceiver) {
      await supabase.from('active_trades').update({ status: 'declined' }).eq('id', trade.id);
      await message.reply({ embeds: [embeds.error('Trade Failed', 'The trade would result in duplicate items. The trade has been cancelled.')] });
      return;
    }

    // Handle role swaps
    if (initiatorItem.shop_items.type === 'role' && initiatorItem.shop_items.role_id) {
      const check = canManageRole(message.guild, initiatorItem.shop_items.role_id);
      if (check.canManage) {
        try {
          const initMember = await message.guild.members.fetch(trade.initiator_id);
          const recvMember = await message.guild.members.fetch(trade.receiver_id);
          await initMember.roles.remove(initiatorItem.shop_items.role_id);
          await recvMember.roles.add(initiatorItem.shop_items.role_id);
        } catch (err) {
          console.error('Role swap error:', err);
        }
      }
    }

    if (receiverItem.shop_items.type === 'role' && receiverItem.shop_items.role_id) {
      const check = canManageRole(message.guild, receiverItem.shop_items.role_id);
      if (check.canManage) {
        try {
          const initMember = await message.guild.members.fetch(trade.initiator_id);
          const recvMember = await message.guild.members.fetch(trade.receiver_id);
          await recvMember.roles.remove(receiverItem.shop_items.role_id);
          await initMember.roles.add(receiverItem.shop_items.role_id);
        } catch (err) {
          console.error('Role swap error:', err);
        }
      }
    }

    // Swap inventory records
    // Update initiator's item to receiver's item
    await supabase
      .from('user_inventory')
      .update({ item_id: trade.receiver_item_id })
      .eq('id', initiatorItem.id);

    // Update receiver's item to initiator's item
    await supabase
      .from('user_inventory')
      .update({ item_id: trade.initiator_item_id })
      .eq('id', receiverItem.id);

    // Mark trade as accepted
    await supabase.from('active_trades').update({ status: 'accepted' }).eq('id', trade.id);

    const embed = embeds.success(
      'Trade Complete! 🤝',
      `**${message.author.username}** accepted the trade!\n🎁 **${initiatorItem.shop_items.name}** ↔️ **${receiverItem.shop_items.name}** 🎁`
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── tradedecline ───
  async tradedecline(message, args, guildId) {
    // Find pending trade where user is the receiver
    const { data: trade, error } = await supabase
      .from('active_trades')
      .select('*')
      .eq('guild_id', guildId)
      .eq('receiver_id', message.author.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !trade) {
      await message.reply({ embeds: [embeds.error('No Trade', 'You have no pending trade offers to decline.')] });
      return;
    }

    await supabase.from('active_trades').update({ status: 'declined' }).eq('id', trade.id);

    const embed = embeds.error(
      'Trade Declined ❌',
      'You declined the trade offer.'
    );
    await message.reply({ embeds: [embed] });
  },

  // ─── tradecancel ───
  async tradecancel(message, args, guildId) {
    // Find pending trade where user is the initiator
    const { data: trade, error } = await supabase
      .from('active_trades')
      .select('*')
      .eq('guild_id', guildId)
      .eq('initiator_id', message.author.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !trade) {
      await message.reply({ embeds: [embeds.error('No Trade', 'You have no pending trade offers to cancel.')] });
      return;
    }

    await supabase.from('active_trades').update({ status: 'cancelled' }).eq('id', trade.id);

    const embed = embeds.warning(
      'Trade Cancelled ⛔',
      'You cancelled your pending trade offer.'
    );
    await message.reply({ embeds: [embed] });
  },
};

module.exports = shopCommands;
