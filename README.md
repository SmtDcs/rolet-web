# ROLET

> A fully on-chain Russian Roulette PvP duel on Solana. Eight chambers, three
> blanks, twelve tactical cards, one $ROLET reward. Cursed CRT-aesthetic UI,
> session-key gasless turns.

**Status:** Working devnet demo (v0.1-working-demo).

---

## Stack

- **L1:** Solana Devnet · Anchor 0.30.1 · Rust
- **Frontend:** Next.js 16 + React 19 · Tailwind v4 · `@coral-xyz/anchor` 0.32
- **RPC:** Helius free tier (devnet)
- **Wallet:** Phantom + Solflare via `@solana/wallet-adapter-react`
- **Reward token:** `$ROLET` (SPL, 6 decimals)
- **Future:** MagicBlock Ephemeral Rollups (TS SDK installed, Rust-side blocked
  on public-crate dep conflict — see HANDOFF.md §9)

## What works

End-to-end FOCG flow on devnet:

```
Connect wallet → Profile enrollment → Lobby (CREATE MATCH)
              → Ghost setup (single user popup) → init_match
              → ARM WEAPON (register_session_key + 0.005 SOL fund)
              → Popup-less turns (session key signs)
              → Card system (12 cards)
              → Ghost AI auto-play (1.5s thinking)
              → HP→0 → Settle → 1 $ROLET claimed
```

## Quickstart

```bash
# 1. Install
pnpm install

# 2. Build the program (--no-idl required, see HANDOFF §9)
cd apps/server
anchor build --no-idl

# 3. Deploy to devnet (one-time)
solana program deploy target/deploy/rolet.so \
  --program-id target/deploy/rolet-keypair.json \
  --url https://api.devnet.solana.com

# 4. Bootstrap vault (creates SPL mint + seeds treasury)
RPC_URL=https://api.devnet.solana.com npx tsx scripts/bootstrap-vault.ts

# 5. Frontend
cd ../web
cp .env.example .env.local   # then fill in NEXT_PUBLIC_RPC_ENDPOINT
pnpm dev
```

Visit `http://localhost:3000`. Phantom must be in **Devnet** mode (Settings →
Developer Settings → Custom RPC).

## Repo layout

```
rolet-web/
├── apps/
│   ├── server/                    # Anchor workspace (Rust program)
│   │   ├── programs/rolet/        # ~1200 LOC Rust
│   │   ├── scripts/               # vault bootstrap (standalone tsx)
│   │   ├── tests/                 # Anchor mocha tests (smoke only)
│   │   └── migrations/            # deploy script
│   └── web/                       # Next.js frontend
│       ├── app/                   # routes (/, /duel, /profile)
│       ├── components/            # SolanaProvider
│       ├── hooks/useRolet.ts      # ~900 LOC integration brain
│       └── idl/rolet.json         # hand-written Anchor 0.30 spec IDL
├── packages/shared/               # workspace package (minimal use)
├── HANDOFF.md                     # full project handoff doc
├── CHECKPOINT-v0.1.md             # snapshot at v0.1-working-demo tag
└── ROADMAP.md                     # what to build next
```

## Documentation map

- **`README.md`** (you are here) — top-level overview
- **`ROADMAP.md`** — feature backlog + branch workflow
- **`HANDOFF.md`** — full architecture, gotchas, on-chain state
- **`CHECKPOINT-v0.1.md`** — frozen snapshot of working demo

## Known limitations

- **MagicBlock ER delegation not active.** SDK has internal version conflicts
  (see HANDOFF.md §9). Game runs on L1 with session keys (~400ms latency).
- **Single-player only.** Ghost opponent auto-plays for now; real 2-player
  matchmaking is on the roadmap.
- **No real Character NFT.** Profile stores a placeholder pubkey for NFT
  (System Program). Mint flow + durability UI on the roadmap.
- **SNS handle is unverified.** Stored as raw string; Bonfida lookup pending.
- **Tests minimal.** Only `init_match` smoke test exists.

## Contributing

This is a hackathon submission. Branch workflow:

```bash
git checkout main
git checkout -b feature/<name>
# work...
git commit -am "..."
# when ready, merge back to main with tag
```

See `ROADMAP.md` for the prioritized backlog.

## License

MIT (or your choice).
