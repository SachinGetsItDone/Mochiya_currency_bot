# 🍡 Mochi Discord Bot

A feature-rich Discord economy bot with tournament management, match betting, and a season-limited shop system.

## Features

- **💰 Economy System** — Wallet balances, daily rewards, transfers, leaderboards, transaction history
- **🏅 Tournament Budget** — Separate tournament budgets, player pool, roster management
- **🎲 Match Betting** — Create matches, place bets, automatic winner payouts
- **🛒 Season Shop** — Season-limited items with stock caps and expiry dates, role assignment, trading, gifting

## Tech Stack

- **Runtime**: Node.js 18+
- **Library**: discord.js v14
- **Database**: Supabase (PostgreSQL)
- **Hosting**: Railway

## Setup

### 1. Discord Application Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application named "Mochi"
3. Go to **Bot** section:
   - Click "Reset Token" and copy the token
   - Enable these **Privileged Gateway Intents**:
     - ✅ Server Members Intent
     - ✅ Message Content Intent *(required for prefix commands)*
4. Go to **OAuth2 > URL Generator**:
   - Select scope: `bot`
   - Select permissions: `Administrator` (or at minimum: `Manage Roles`, `Send Messages`, `Embed Links`, `Read Message History`)
   - Copy and open the invite URL to add the bot to your server

### 2. Supabase Setup

1. Create a project at [Supabase](https://supabase.com)
2. Go to **SQL Editor > New Query**
3. Copy the contents of `supabase/schema.sql` and run it
4. Go to **Project Settings > API**:
   - Copy **Project URL**
   - Copy **service_role key** (NOT the anon key — the bot needs admin access)

### 3. Local Development

```bash
# Clone the repo and cd into it
cp .env.example .env
# Fill in your values in .env
npm install
npm run dev
```

### 4. Railway Deployment

#### Option A: Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Create project and deploy
railway init
railway up
```

#### Option B: Railway Dashboard (Recommended)

1. Push this project to a GitHub repository
2. Go to [Railway Dashboard](https://railway.app/dashboard)
3. Click **New Project > Deploy from GitHub repo**
4. Select your repository
5. Go to **Variables** and add all env vars from `.env.example`
6. Railway will auto-detect the `railway.toml` and `Dockerfile` and deploy

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Your Discord bot token |
| `DISCORD_CLIENT_ID` | Your Discord application/client ID |
| `COMMAND_PREFIX` | Command prefix (default: `mochi`) |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Your Supabase service role key |

## Command Reference

### Economy

| Command | Description |
|---------|-------------|
| `mochi cash` | Check your balance |
| `mochi cash @user` | Check another user's balance |
| `mochi daily` | Claim daily coins (24h cooldown) |
| `mochi pay @user <amount>` | Transfer coins |
| `mochi top` | Leaderboard |
| `mochi history` | Transaction history |

### Tournament

| Command | Description |
|---------|-------------|
| `mochi budget` | Check your tournament budget |
| `mochi players` | List available players |
| `mochi buy <player>` | Buy a player with budget |
| `mochi roster` | View your roster |

### Match Betting

| Command | Description |
|---------|-------------|
| `mochi matches` | List open matches |
| `mochi matchinfo <id>` | Match details |
| `mochi support <player> <amount>` | Place a bet |

### Season Shop

| Command | Description |
|---------|-------------|
| `mochi shop` | Browse items |
| `mochi shopbuy <item>` | Purchase item |
| `mochi collection` / `mochi flex` | Your items |
| `mochi gift @user <item>` | Gift an item |
| `mochi trade @user <your item> for <their item>` | Propose trade |
| `mochi tradeaccept` | Accept trade |
| `mochi tradedecline` | Decline trade |

### Admin Commands (Administrator permission required)

| Command | Description |
|---------|-------------|
| `mochi give @user <amount>` | Grant coins |
| `mochi setbudget @user <amount>` | Set tournament budget |
| `mochi addplayer <name> <price>` | Add player to pool |
| `mochi creatematch <A> <B>` | Create betting match |
| `mochi endmatch <id> <winner>` | End match & payout |
| `mochi cancelmatch <id>` | Cancel & refund |
| `mochi additem <name> <price> <stock> <date> <type> <rarity> <desc> [role_id]` | Add shop item |
| `mochi removeitem <name>` | Remove shop item |

## Project Structure

```
├── src/
│   ├── index.js              # Bot entry point & command handler
│   ├── config.js             # Environment config
│   ├── commands/
│   │   ├── economy.js        # cash, daily, pay, give, top, history
│   │   ├── tournament.js     # setbudget, budget, addplayer, players, buy, roster
│   │   ├── betting.js        # creatematch, matches, matchinfo, support, endmatch, cancelmatch
│   │   └── shop.js           # shop, shopbuy, collection, additem, removeitem, gift, trade
│   └── utils/
│       ├── supabase.js       # Supabase client
│       ├── wallet.js         # Balance helpers (getBalance, credit, debit, transfer)
│       ├── permissions.js    # Admin & role permission checks
│       └── embeds.js         # Embed formatting utilities
├── supabase/
│   └── schema.sql            # Full database setup
├── package.json
├── .env.example
├── .gitignore
├── Dockerfile                # Railway deployment
└── railway.toml              # Railway configuration
```

## License

MIT
