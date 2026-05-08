# ROLET

> A fully on-chain PvP Russian Roulette on Solana. Eight chambers, tactical
> cards, session-key gasless turns, real 2-player matchmaking via on-chain
> Lobby PDA. One winner claims `$ROLET`.

**Live demo:** `https://YOUR_VERCEL_URL` (Solana Devnet)  
**Program:** [`2ePEUzCFcxD559Hy3irB2TGbYAwU2UD352sVj77QPrS7`](https://explorer.solana.com/address/2ePEUzCFcxD559Hy3irB2TGbYAwU2UD352sVj77QPrS7?cluster=devnet) on devnet

---

## What is it?

Two players share a revolver loaded with **5 live + 3 blank** rounds in 8 chambers. Each turn: play a card or pull the trigger. HP hits 0 → game over. Winner claims tokens from the on-chain vault.

Twelve tactical cards change everything: reveal the next chamber (HawkEye), eject it (BulletExtractor), deal double damage (DoubleStrike), shield the next shot (Blocker), and more.

All state lives on Solana L1. No server, no database.

---

## Full game flow

```
Player A                                Player B
────────                                ────────
Connect wallet                          Connect wallet
↓                                       ↓
/profile → init_player_profile          /profile → init_player_profile
↓
/duel → CREATE LOBBY
  └─ open_lobby (Lobby PDA on-chain)
     └─ share link: /duel?join=<id>
                                        Open shared link
                                        └─ join_lobby (commits secret)
↓
"Guest joined" detected (polling)
└─ LAUNCH MATCH
   └─ init_match (commits host secret + seals RNG from both)
   └─ close_lobby (Lobby PDA cleaned up)
↓                                       ↓
ARM WEAPON                              ARM WEAPON
└─ register_session_key                 └─ register_session_key
   (1 popup, then gasless)
↓                                       ↓
Turn loop (popup-free via session key)
├─ pull_trigger / play_card
├─ HP damage, card effects
└─ next turn...
↓
settle_match → winner claims $ROLET
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Solana Devnet (L1)                     │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ PlayerProfile│  │  MatchState  │  │   GameVault    │  │
│  │     PDA      │  │     PDA      │  │     PDA        │  │
│  │ (per wallet) │  │ (per match)  │  │ ($ROLET pool)  │  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │                  LobbyState PDA                   │   │
│  │  seeds: ["lobby", match_id (le64)]               │   │
│  │  host_commit · guest_commit · guest_secret       │   │
│  │  Created by host → closed after init_match       │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
          ▲ HTTP polling (1.5s)     ▲ instruction send
          │                         │
┌─────────┴─────────────────────────┴───────────────────┐
│                 Next.js 16 Frontend                    │
│                                                        │
│  useRolet hook → Anchor client → Helius RPC            │
│  Session keys → popup-free turns                       │
│  Commit-reveal → RNG from both players' secrets        │
└────────────────────────────────────────────────────────┘
```

**Commit-reveal RNG:** Host and guest each generate a random secret off-chain, hash it (keccak256), and submit the hash on-chain. After both are committed, the match seeds its RNG from `hash(host_secret ‖ guest_secret)`. Neither player can manipulate the outcome — revealing the other's secret first would break the hash.

**Session keys:** Registered on-chain via `register_session_key`. The session keypair signs turns locally, eliminating wallet popups for the entire session duration.

---

## Stack

| Layer | Tech |
|-------|------|
| Program | Anchor 0.30.1 · Rust · Solana Devnet |
| Frontend | Next.js 16 · React 19 · Tailwind v4 |
| Wallet | Phantom + Solflare via `@solana/wallet-adapter` |
| RPC | Helius (devnet) |
| Reward | `$ROLET` SPL token (6 decimals) |

---

## Quickstart (local dev)

```bash
# 1. Install
pnpm install

# 2. Build the program
cd apps/server
anchor build --no-idl        # --no-idl is required (see HANDOFF §9)

# 3. Deploy to devnet (one-time)
solana program deploy target/deploy/rolet.so \
  --program-id target/deploy/rolet-keypair.json \
  --url https://api.devnet.solana.com

# 4. Bootstrap vault (creates $ROLET mint + seeds treasury)
RPC_URL=https://api.devnet.solana.com npx tsx scripts/bootstrap-vault.ts

# 5. Frontend
cd ../web
cp .env.example .env.local   # set NEXT_PUBLIC_RPC_ENDPOINT
pnpm dev
```

Open `http://localhost:3000`. Set wallet to **Devnet** mode.

---

## Repo layout

```
rolet-web/
├── apps/
│   ├── server/
│   │   ├── programs/rolet/src/lib.rs   # ~1300 LOC Anchor program
│   │   └── scripts/bootstrap-vault.ts  # vault init (run once)
│   └── web/
│       ├── app/                        # routes: /, /duel, /profile
│       ├── hooks/useRolet.ts           # ~1000 LOC Anchor client + game logic
│       └── idl/rolet.json              # Anchor IDL
├── packages/shared/
├── HANDOFF.md                          # full architecture + gotchas
├── ROADMAP.md                          # feature backlog
└── CHECKPOINT-v0.1.md                  # v0.1 snapshot
```

---

## Known limitations

- **MagicBlock ER not active.** SDK has a `solana-program` type-split conflict with Anchor 0.30.1. Game runs on L1 with session keys (~400ms latency). See HANDOFF §9.
- **No Character NFT yet.** Profile stores a placeholder; Metaplex Core mint flow is on the roadmap.
- **SNS handles unverified.** Stored as raw string; Bonfida lookup pending.
- **Tests minimal.** `init_match` smoke test only.

---

## License

MIT
