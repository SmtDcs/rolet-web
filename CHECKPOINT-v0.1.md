# ROLET Checkpoint v0.1 — Working Demo

**Date:** 2026-05-07
**Git tag:** `v0.1-working-demo`
**Status:** End-to-end FOCG flow verified on devnet

---

## What works (verified on chain)

1. **Profile enrollment** — `init_player_profile` stores SNS handle, durability 10, ELO 1000
2. **Lobby create + ghost setup** — single-tx ghost SOL fund (0.02 SOL) + ghost profile init
3. **Match init** — commit-reveal seeded RNG, deterministic chamber shuffle (5 Live, 3 Blank)
4. **Session arming** — `register_session_key` (24h max) + 0.005 SOL fund to session keypair
5. **Gasless turns** — session key signs play_card / pull_trigger on L1; no Phantom popup per turn
6. **All 12 cards implemented** — HawkEye, BulletExtractor, Silence, Blocker, DoubleStrike, Healer, RestoreBullet, Shuffler, CardThief, RandomInsight, LastChance, HandOfFate
7. **Ghost AI auto-play** — 1.5s "thinking" delay, 70% target opponent / 30% self, signs with stashed ghost keypair
8. **Match completion** — HP→0 sets status Completed, winner recorded
9. **Settle + reward transfer** — vault → winner ATA (auto-creates ATA if missing), 1 $ROLET payout
10. **Durability decrement** — both profiles drop 1 durability post-settle
11. **Match account close** — rent refund to caller via `close = rent_refund`
12. **HTTP polling fallback** — 1.5s interval; UI stays in sync even when Helius WS rejects connections

---

## Devnet on-chain state (as of checkpoint)

| Resource          | Value                                                         |
|-------------------|---------------------------------------------------------------|
| Program ID        | `2ePEUzCFcxD559Hy3irB2TGbYAwU2UD352sVj77QPrS7`                |
| Authority         | `9uJcwroPnjEAZPEv5nMuWX2df6vGptNUC2aGaNV6Pw2o`                |
| Reward Mint       | `6q6aq9KXSo23xJpfmvDGrpHw4SQSGXb2MUwMjdLDUnZm` (6 dec)        |
| Vault PDA         | `8Md5fzBfXU2EmPDnVgddrrygp2cHjoDBvkwC7tT4BFxb` (bump 253)     |
| Treasury ATA      | `6GWmHFsdrFXefage8pvvLrsvnWwkpbibENifS8JE1CWt`                |
| Treasury balance  | 999 $ROLET (1 paid out so far)                                |
| Matches settled   | 1                                                             |
| RPC               | `https://devnet.helius-rpc.com/?api-key=…` (free tier)        |
| ER endpoint       | `https://devnet.magicblock.app` (configured but not used yet) |

---

## Architectural state

### PLAN_B in effect (intentional)
- `ephemeral-rollups-sdk` (Rust) NOT linked due to `dlp_api` / `solana-instruction` version split with Anchor 0.30.1
- ER delegation moved to client side via `@magicblock-labs/ephemeral-rollups-sdk` (TS) — but client-only call fails with "Missing signature for PDA" because delegation needs owner-program CPI
- Gracefully degrades: `delegateMatch` toast says "ER delegation unavailable", match runs on L1
- L1 path is fully functional — gasless via session keys, ~400ms slot latency, all instructions work

### Routing decisions
- All instructions route to `programL1` (devnet RPC). The dual-program (`programL1` / `programER`) infrastructure is in place but ER routing is currently disabled in `playCard` / `pullTrigger`.
- `commitAndUndelegateMatch` gracefully no-ops when match was never delegated (catches "read-only" error)
- WebSocket subscribe is a no-op (Helius free tier blocks WS; HTTP polling covers updates)

---

## Files that matter (in order of importance)

| File                                                  | Lines | Purpose                          |
|-------------------------------------------------------|------:|----------------------------------|
| `apps/server/programs/rolet/src/lib.rs`               | ~1200 | THE Anchor program               |
| `apps/web/hooks/useRolet.ts`                          | ~700  | Web3 integration layer           |
| `apps/web/idl/rolet.json`                             | ~500  | Hand-written IDL (no auto-gen)   |
| `apps/web/app/duel/page.tsx`                          | ~900  | Duel UI + Lobby + ghost AI       |
| `apps/web/app/profile/page.tsx`                       | ~200  | Enrollment / stats               |
| `apps/web/app/page.tsx`                               | ~190  | Main menu                        |
| `apps/web/app/layout.tsx`                             | ~60   | CRT overlay + SolanaProvider     |
| `apps/web/components/SolanaProvider.tsx`              | ~30   | Wallet adapter setup             |
| `apps/web/.env.local`                                 | ~15   | RPC + program ID + Helius key    |
| `apps/server/scripts/bootstrap-vault.ts`              | ~110  | Standalone vault init            |
| `apps/server/Anchor.toml`                             | ~35   | Anchor config                    |
| `apps/server/programs/rolet/Cargo.toml`               | ~25   | Rust deps                        |
| `HANDOFF.md`                                          | ~400  | Full project handoff doc         |

---

## How to roll back

```bash
cd /home/sametether/projects/rolet-web
git status                    # see what's changed since checkpoint
git diff v0.1-working-demo    # see all diffs since this snapshot

# Roll EVERYTHING back to this checkpoint:
git reset --hard v0.1-working-demo

# Or just one file:
git checkout v0.1-working-demo -- apps/server/programs/rolet/src/lib.rs

# Or branch off this checkpoint to experiment:
git checkout -b experiment-er-delegation v0.1-working-demo
```

After roll-back, you may need to:
- `cd apps/server && rm -f Cargo.lock && anchor build --no-idl` — rebuild Rust
- `solana program deploy ...` — redeploy if Rust changed
- `pnpm install` — restore deps if package.json changed
- The `.env.local` file is NOT in git (intentional — has API keys). Keep it backed up separately.

---

## Critical state NOT in git

These files are gitignored but contain values you'd want if rebuilding from scratch:

### `apps/web/.env.local`
```
NEXT_PUBLIC_RPC_ENDPOINT=https://devnet.helius-rpc.com/?api-key=a2098f98-3d10-4d26-b08a-02ae49d98cd2
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_ROLET_PROGRAM_ID=2ePEUzCFcxD559Hy3irB2TGbYAwU2UD352sVj77QPrS7
NEXT_PUBLIC_MAGICBLOCK_ER_ENDPOINT=https://devnet.magicblock.app
```

### `apps/server/migrations/.reward-mint.json`
```
{"mint":"6q6aq9KXSo23xJpfmvDGrpHw4SQSGXb2MUwMjdLDUnZm"}
```

### `apps/server/target/deploy/rolet-keypair.json`
The program-ID keypair. **DO NOT LOSE** — losing it means the program at `2ePEUz…QPrS7` becomes unupgradeable. If lost, you must deploy with a new keypair (new program ID), update IDL `address` field, update `.env.local`, and re-bootstrap vault.

---

## Next steps from here (priority order for hackathon)

1. **Real MagicBlock ER delegation** — Rust manual CPI (no SDK macro) → sub-second turns
2. **Real 2-player matchmaking** — replace ghost with on-chain rendezvous lobby
3. **Character NFT mint flow** — Metaplex Core, durability bar UI
4. **SNS resolution** — `@bonfida/spl-name-service` ownership check
5. **Demo screencast + README polish** — submission package
