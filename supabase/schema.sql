-- ============================================
-- Mochi Bot - Supabase PostgreSQL Schema
-- ============================================
-- Run this in your Supabase SQL Editor to set up all tables,
-- indexes, and the atomic add_balance RPC function.
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. Wallets Table
-- ============================================
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  last_daily TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_wallets_guild_user ON wallets(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_guild_balance ON wallets(guild_id, balance DESC);

-- ============================================
-- 2. Transactions Table
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id TEXT NOT NULL,
  from_user TEXT,
  to_user TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  type TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_guild ON transactions(guild_id);
CREATE INDEX IF NOT EXISTS idx_transactions_from ON transactions(from_user);
CREATE INDEX IF NOT EXISTS idx_transactions_to ON transactions(to_user);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_guild_from ON transactions(guild_id, from_user, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_guild_to ON transactions(guild_id, to_user, created_at DESC);

-- ============================================
-- 3. Budgets Table (Tournament)
-- ============================================
CREATE TABLE IF NOT EXISTS budgets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  spent INTEGER NOT NULL DEFAULT 0 CHECK (spent >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_budgets_guild_user ON budgets(guild_id, user_id);

-- ============================================
-- 4. Players Table (Tournament Pool)
-- ============================================
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  owner_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(guild_id, name)
);

CREATE INDEX IF NOT EXISTS idx_players_guild ON players(guild_id);
CREATE INDEX IF NOT EXISTS idx_players_guild_owner ON players(guild_id, owner_id) WHERE owner_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_players_guild_owner_id ON players(guild_id, owner_id);

-- ============================================
-- 5. Matches Table
-- ============================================
CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  player_a TEXT NOT NULL,
  player_b TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
  winner TEXT,
  odds_a NUMERIC(5,2), -- Odds multiplier for Player A (e.g. 1.15)
  odds_b NUMERIC(5,2), -- Odds multiplier for Player B (e.g. 2.00)
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matches_guild_status ON matches(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_matches_guild ON matches(guild_id);

-- ============================================
-- 6. Match Bets Table
-- ============================================
CREATE TABLE IF NOT EXISTS match_bets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  supported TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(match_id, user_id) -- One bet per user per match
);

CREATE INDEX IF NOT EXISTS idx_match_bets_match ON match_bets(match_id);
CREATE INDEX IF NOT EXISTS idx_match_bets_guild_user ON match_bets(guild_id, user_id);

-- ============================================
-- 7. Shop Items Table
-- ============================================
CREATE TABLE IF NOT EXISTS shop_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL CHECK (stock >= 0),
  stock_remaining INTEGER NOT NULL CHECK (stock_remaining >= 0),
  expiry_date TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('role', 'collectible')),
  role_id TEXT,
  rarity TEXT NOT NULL CHECK (rarity IN ('Common', 'Rare', 'Epic', 'Legendary')),
  season_label TEXT,
  is_active BOOLEAN DEFAULT TRUE NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(guild_id, name)
);

CREATE INDEX IF NOT EXISTS idx_shop_items_guild ON shop_items(guild_id);
CREATE INDEX IF NOT EXISTS idx_shop_items_guild_available ON shop_items(guild_id, stock_remaining, expiry_date) WHERE stock_remaining > 0 AND is_active = TRUE;

-- ============================================
-- 8. User Inventory Table
-- ============================================
CREATE TABLE IF NOT EXISTS user_inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  item_id UUID NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  season_label TEXT,
  UNIQUE(guild_id, user_id, item_id) -- No duplicate items per user
);

CREATE INDEX IF NOT EXISTS idx_inventory_user ON user_inventory(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_item ON user_inventory(item_id);

-- ============================================
-- 9. Active Trades Table
-- ============================================
CREATE TABLE IF NOT EXISTS active_trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id TEXT NOT NULL,
  initiator_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  initiator_item_id UUID NOT NULL REFERENCES shop_items(id),
  receiver_item_id UUID NOT NULL REFERENCES shop_items(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_receiver ON active_trades(guild_id, receiver_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_trades_initiator ON active_trades(guild_id, initiator_id, status) WHERE status = 'pending';

-- ============================================
-- RPC Function: Atomic Balance Update
-- ============================================
-- This function prevents race conditions when multiple
-- commands try to update a wallet simultaneously.
CREATE OR REPLACE FUNCTION add_balance(
  p_user_id TEXT,
  p_guild_id TEXT,
  p_amount INTEGER
) RETURNS INTEGER AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
BEGIN
  -- Lock the row and get current balance
  SELECT balance INTO v_current_balance
  FROM wallets
  WHERE user_id = p_user_id AND guild_id = p_guild_id
  FOR UPDATE;

  -- If wallet doesn't exist, create it with 0 balance
  IF v_current_balance IS NULL THEN
    v_current_balance := 0;
    INSERT INTO wallets (user_id, guild_id, balance, last_daily)
    VALUES (p_user_id, p_guild_id, 0, NULL);
  END IF;

  -- Calculate new balance
  v_new_balance := v_current_balance + p_amount;

  -- Prevent negative balances
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient balance: current %, attempted debit %', v_current_balance, ABS(p_amount);
  END IF;

  -- Update balance
  UPDATE wallets
  SET balance = v_new_balance,
      updated_at = NOW()
  WHERE user_id = p_user_id AND guild_id = p_guild_id;

  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;

-- RPC Function: Atomic Balance Transfer
-- This function runs inside a single database transaction, preventing race
-- conditions where one side is debited but the other is not credited.
CREATE OR REPLACE FUNCTION transfer_balance(
  p_from_user_id TEXT,
  p_to_user_id TEXT,
  p_guild_id TEXT,
  p_amount INTEGER,
  p_note TEXT
) RETURNS VOID AS $$
DECLARE
  v_sender_balance INTEGER;
  v_receiver_balance INTEGER;
BEGIN
  -- 1. Ensure sender wallet exists (locking the row)
  SELECT balance INTO v_sender_balance
  FROM wallets
  WHERE user_id = p_from_user_id AND guild_id = p_guild_id
  FOR UPDATE;

  IF v_sender_balance IS NULL THEN
    -- Sender has no wallet -> 0 balance, definitely insufficient
    RAISE EXCEPTION 'Insufficient balance: sender has no wallet';
  END IF;

  -- 2. Check sender balance
  IF v_sender_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance: current %, attempted transfer %', v_sender_balance, p_amount;
  END IF;

  -- 3. Ensure receiver wallet exists (locking the row)
  SELECT balance INTO v_receiver_balance
  FROM wallets
  WHERE user_id = p_to_user_id AND guild_id = p_guild_id
  FOR UPDATE;

  IF v_receiver_balance IS NULL THEN
    INSERT INTO wallets (user_id, guild_id, balance, last_daily)
    VALUES (p_to_user_id, p_guild_id, 0, NULL);
  END IF;

  -- 4. Perform debit
  UPDATE wallets
  SET balance = balance - p_amount,
      updated_at = NOW()
  WHERE user_id = p_from_user_id AND guild_id = p_guild_id;

  -- 5. Perform credit
  UPDATE wallets
  SET balance = balance + p_amount,
      updated_at = NOW()
  WHERE user_id = p_to_user_id AND guild_id = p_guild_id;

  -- 6. Log transaction record
  INSERT INTO transactions (guild_id, from_user, to_user, amount, type, note)
  VALUES (p_guild_id, p_from_user_id, p_to_user_id, p_amount, 'transfer', p_note);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Comments for documentation
-- ============================================
COMMENT ON TABLE wallets IS 'User coin balances per guild';
COMMENT ON TABLE transactions IS 'Logged coin transfers and rewards';
COMMENT ON TABLE budgets IS 'Tournament budget allocations per user per guild';
COMMENT ON TABLE players IS 'Tournament player pool with pricing';
COMMENT ON TABLE matches IS 'Tournament matches for betting';
COMMENT ON TABLE match_bets IS 'User bets on matches';
COMMENT ON TABLE shop_items IS 'Season-limited shop items';
COMMENT ON TABLE user_inventory IS 'User-owned items';
COMMENT ON TABLE active_trades IS 'Pending item trades between users';
COMMENT ON FUNCTION add_balance IS 'Atomically adds/subtracts balance from a wallet. Returns new balance.';

-- ============================================
-- Row Level Security (Optional but Recommended)
-- ============================================
-- If you enable RLS, you'll need policies. For bot usage with
-- service role key, RLS is typically bypassed. Uncomment below
-- if you want to add basic RLS policies.

-- ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE players ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE match_bets ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE shop_items ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_inventory ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE active_trades ENABLE ROW LEVEL SECURITY;
