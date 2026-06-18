const { supabase } = require('./supabase');

/**
 * Get a user's wallet balance
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @returns {Promise<number>} - Current balance
 */
async function getBalance(userId, guildId) {
  await ensureWallet(userId, guildId);

  const { data, error } = await supabase
    .from('wallets')
    .select('balance')
    .eq('user_id', userId)
    .eq('guild_id', guildId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data?.balance || 0;
}

/**
 * Ensure a wallet exists for a user (creates if not exists)
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 */
async function ensureWallet(userId, guildId) {
  const { error } = await supabase
    .from('wallets')
    .upsert(
      { user_id: userId, guild_id: guildId, balance: 0 },
      { onConflict: ['user_id', 'guild_id'] }
    );

  if (error) throw error;
}

/**
 * Atomically add balance to a wallet (positive = credit, negative = debit)
 * Uses Supabase RPC to prevent race conditions
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @param {number} amount - Amount to add (negative to subtract)
 * @returns {Promise<number>} - New balance
 */
async function addBalance(userId, guildId, amount) {
  await ensureWallet(userId, guildId);

  const { data, error } = await supabase.rpc('add_balance', {
    p_user_id: userId,
    p_guild_id: guildId,
    p_amount: amount,
  });

  if (error) throw error;
  return data;
}

/**
 * Credit (add) coins to a wallet
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @param {number} amount - Amount to credit
 * @param {string} type - Transaction type
 * @param {string} note - Transaction note
 * @param {string|null} fromUser - Source user ID
 */
async function credit(userId, guildId, amount, type = 'credit', note = '', fromUser = null) {
  if (amount <= 0) throw new Error('Credit amount must be positive');

  const newBalance = await addBalance(userId, guildId, amount);

  // Log transaction
  await supabase.from('transactions').insert({
    guild_id: guildId,
    from_user: fromUser,
    to_user: userId,
    amount: amount,
    type: type,
    note: note,
  });

  return newBalance;
}

/**
 * Debit (subtract) coins from a wallet
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @param {number} amount - Amount to debit
 * @param {string} type - Transaction type
 * @param {string} note - Transaction note
 * @param {string|null} toUser - Destination user ID
 * @returns {Promise<number>} - New balance
 */
async function debit(userId, guildId, amount, type = 'debit', note = '', toUser = null) {
  if (amount <= 0) throw new Error('Debit amount must be positive');

  // Atomic debit via add_balance RPC (will throw if insufficient)
  const newBalance = await addBalance(userId, guildId, -amount);

  // Log transaction
  await supabase.from('transactions').insert({
    guild_id: guildId,
    from_user: userId,
    to_user: toUser,
    amount: amount,
    type: type,
    note: note,
  });

  return newBalance;
}

/**
 * Transfer coins between two wallets
 * @param {string} fromUserId - Sender user ID
 * @param {string} toUserId - Receiver user ID
 * @param {string} guildId - Guild ID
 * @param {number} amount - Amount to transfer
 * @param {string} note - Transaction note
 */
async function transfer(fromUserId, toUserId, guildId, amount, note = 'Transfer') {
  if (amount <= 0) throw new Error('Transfer amount must be positive');
  if (fromUserId === toUserId) throw new Error('Cannot transfer to yourself');

  // Call the atomic transfer RPC
  const { data, error } = await supabase.rpc('transfer_balance', {
    p_from_user_id: fromUserId,
    p_to_user_id: toUserId,
    p_guild_id: guildId,
    p_amount: amount,
    p_note: note
  });

  if (error) throw error;
  return data;
}

module.exports = {
  getBalance,
  ensureWallet,
  addBalance,
  credit,
  debit,
  transfer,
};
