# ROLET — Project Handoff Document

**Status as of:** 2026-05-06
**Repo root:** `/home/sametether/projects/rolet-web`
**Target submission:** Solana Colosseum / Frontier Hackathon
**Stack:** Anchor 0.30.1 (Rust) · Next.js 16 + React 19 · Solana web3.js · Tailwind v4 · MagicBlock Ephemeral Rollups (planned, see PLAN_B)

---

## 1. Game Vision

**ROLET** is a fully-on-chain (FOCG) PvP turn-based strategy game inspired by Russian Roulette + Buckshot Roulette. Two players sit at a table, take turns pulling the trigger of an 8-chamber revolver loaded with 5 live + 3 blank rounds. They can play tactical cards (HawkEye, BulletExtractor, DoubleStrike, etc.) to manipulate the chamber order or modify damage. Winner takes the vault payout.

**Aesthetic:** 2.5D fixed-camera, gritty/cursed industrial. Cracked porcelain mask opponent, rusty hand-cannon, cursed-monitor CRT/scanline overlay.

### Economy (no wagering)
- Players use a **Character NFT** with limited **Durability** (e.g. 10 matches).
- Each match costs 1 Durability per player.
- Winner claims a token reward (`$ROLET`, SPL) from the **GameVault** treasury PDA.
- Loser gets nothing. NFT can be repaired/restored later (mechanic TBD).

### Identity
- **PlayerProfile PDA** stores: SNS domain (string), durability remaining/max, lifetime stats (wins/losses/ELO), session key + expiry.
- Profile is created once via `init_player_profile` (one-time enrollment popup).

---

## 2. Architecture Decision: FOCG via MagicBlock (with PLAN_B caveat)

The original design used MagicBlock's **Ephemeral Rollup (ER)** to give the turn-based loop "Web2 speed" — sub-second finality, gasless turns via session keys. The Rust program was supposed to use `ephemeral-rollups-sdk` macros (`#[delegate]`, `#[commit]`) to mark `MatchState` as delegatable.

### PLAN_B (current state)
Building `ephemeral-rollups-sdk` (any version 0.10–0.13) against Anchor 0.30.1 fails because the SDK transitively pulls in `dlp_api`, which uses the *new* `solana-instruction`/`solana-address` crate split, while Anchor 0.30.1 brings the *old* monolithic `solana-program` types. Result: 16 × `E0308: mismatched types` errors, all between `&Address` vs `&Pubkey` and `solana_program::Instruction` vs `solana_instruction::Instruction`.

Anchor 0.31.1 didn't help — same dlp_api split. Older SDK versions (0.0.16 era) failed inversely with `as_array` not found on Pubkey.

**Decision: strip MagicBlock SDK from the Rust program entirely. Move ER delegation to the frontend** using the TypeScript SDK `@magicblock-labs/ephemeral-rollups-sdk` (which has a different import model and avoids the type-split). This is **NOT YET IMPLEMENTED** — the frontend `delegateMatch()` is a no-op stub. See "Next Steps" §8.

### What this means today
- `play_card`, `pull_trigger`, `init_match`, `settle_match`, `register_session_key`, `init_player_profile`, `init_vault` all **work on L1** (localnet, devnet).
- Session keys work fully on-chain (single popup at session start, then no popups for turns).
- ER delegation is **not yet wired** — every action goes to L1 directly. Latency is ~400ms per slot (acceptable but not "Web2 fast").
- The Rust program is **MagicBlock-aware in spirit but not in code**: it knows `MatchState` may live on the ER (because it can be read from there transparently once the TS SDK delegates it), but the program does not call any MagicBlock CPIs itself.

---

## 3. Repo Layout

```
rolet-web/
├── HANDOFF.md                          ← this file
├── package.json                        (pnpm workspace root)
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── apps/
│   ├── server/                         ← Anchor workspace (Solana program)
│   │   ├── Anchor.toml
│   │   ├── Cargo.toml                  (Rust workspace)
│   │   ├── tsconfig.json               (legacy server's TS config — keep)
│   │   ├── tsconfig.anchor.json        (for anchor mocha tests)
│   │   ├── package.json                (anchor scripts)
│   │   ├── programs/rolet/
│   │   │   ├── Cargo.toml              (anchor-lang 0.30.1, anchor-spl 0.30.1)
│   │   │   ├── Xargo.toml
│   │   │   └── src/lib.rs              ← THE Rust program (~1000 lines)
│   │   ├── tests/rolet.ts              (init_match smoke test)
│   │   ├── migrations/deploy.ts        (anchor migrate; uses anchor.workspace)
│   │   ├── scripts/
│   │   │   └── bootstrap-vault.ts      ← standalone vault bootstrap (USE THIS)
│   │   ├── target/                     (build artifacts; .so + idl)
│   │   └── src/                        (LEGACY socket.io — delete safely)
│   └── web/                            ← Next.js 16 frontend
│       ├── package.json
│       ├── next.config.ts
│       ├── tsconfig.json               (paths: "@/*": ["./*"])
│       ├── postcss.config.mjs          (tailwindcss/postcss)
│       ├── .env.local                  ← localnet RPC + program ID
│       ├── AGENTS.md                   ← reads "this is NOT the Next.js you know"
│       ├── CLAUDE.md                   ← @AGENTS.md
│       ├── app/
│       │   ├── globals.css             (Tailwind v4 @theme + @utility + keyframes)
│       │   ├── layout.tsx              (CRT overlay + SolanaProvider wrap)
│       │   ├── page.tsx                ("/" main menu)
│       │   ├── duel/page.tsx           (Lobby + ActiveDuel; Suspense wrapper)
│       │   └── profile/page.tsx        (enroll / show profile)
│       ├── components/
│       │   └── SolanaProvider.tsx      (Phantom + Solflare adapter)
│       ├── hooks/
│       │   └── useRolet.ts             ← THE integration hook (~700 lines)
│       └── idl/
│           ├── rolet.json              ← hand-written Anchor 0.30 spec IDL
│           └── rolet_types.ts          (just `export type Rolet = typeof idl`)
└── packages/
    └── shared/                         (workspace package; minimal usage)
```

### Legacy / stale (safe to delete when you're sure)
- `apps/server/src/{events,game,rooms,index.ts}` — the old socket.io Web2 server. Replaced by FOCG architecture. The old `package.json` deps `express`, `socket.io`, `cors` are similarly unused.

### Mobile-first / NFT mint flows / SNS resolution
Not built. See "Next Steps" §8.

---

## 4. Current On-Chain State (Localnet)

A `solana-test-validator --reset` is running. Program is deployed and vault is bootstrapped:

| Resource           | Value                                                        |
|--------------------|--------------------------------------------------------------|
| RPC                | `http://127.0.0.1:8899`                                      |
| Wallet (deployer)  | `9uJcwroPnjEAZPEv5nMuWX2df6vGptNUC2aGaNV6Pw2o`               |
| Wallet balance     | ~500M SOL (test validator faucet)                            |
| Program ID         | `2ePEUzCFcxD559Hy3irB2TGbYAwU2UD352sVj77QPrS7`               |
| Program keypair    | `apps/server/target/deploy/rolet-keypair.json`               |
| .so binary         | `apps/server/target/deploy/rolet.so` (~347 KB)               |
| Reward mint        | `3YhWHv81nhr3znD6nohVCcxd8qQuM1DvhAnoD5RNH6CB` (6 decimals)  |
| Reward mint cache  | `apps/server/migrations/.reward-mint.json`                   |
| Vault PDA          | seeds `[b"vault"]`, bump 253                                 |
| Treasury ATA       | `ELgfVtVQcQtopxWj8h7qi6W14rbvjqeFfRxK838UYiv2`               |
| Treasury balance   | 1000 $ROLET                                                  |
| Base reward / win  | 1 $ROLET                                                     |

**To verify:**
```bash
solana program show 2ePEUzCFcxD559Hy3irB2TGbYAwU2UD352sVj77QPrS7 --url http://127.0.0.1:8899
spl-token balance 3YhWHv81nhr3znD6nohVCcxd8qQuM1DvhAnoD5RNH6CB --url http://127.0.0.1:8899
```

---

## 5. Anchor Program — Instructions (`apps/server/programs/rolet/src/lib.rs`)

All instructions fully implemented and on-chain:

| Instruction              | Purpose                                                                             | Caller        | State touched                                                            |
|--------------------------|-------------------------------------------------------------------------------------|---------------|--------------------------------------------------------------------------|
| `init_player_profile`    | One-time enrollment. Stores SNS handle, durability, stats, bump.                    | User          | `PlayerProfile` PDA = `[b"profile", authority]`                          |
| `init_vault`             | One-time admin bootstrap. Sets reward mint + treasury ATA + base reward.            | Admin/payer   | `GameVault` PDA = `[b"vault"]` + treasury ATA                            |
| `register_session_key`   | Authorize a temp keypair to sign turns for `duration_seconds` (max 24h).            | Wallet        | Updates `PlayerProfile.session_key` + `session_key_expiry`               |
| `init_match`             | Commit-Reveal seeded match init. Random gun shuffle + 4 cards/player.               | Either player | Creates `MatchState` PDA = `[b"match", match_id]`                        |
| `play_card`              | Apply card effect. Validates signer is wallet OR session key.                       | Current turn  | Mutates `MatchState`. Reads `current_profile`.                           |
| `pull_trigger`           | Russian Roulette core. Damage, blocker, doublestrike, blank-keeps-turn, KO check.  | Current turn  | Mutates `MatchState`. Reads `current_profile`.                           |
| `settle_match`           | After `Completed`: decrements durability, transfers reward, closes `MatchState`.    | Anyone        | Mutates `GameVault` + both `PlayerProfile`s; CPIs to SPL Token.          |

### Card implementation status

| Card             | Status        | Notes                                                              |
|------------------|---------------|--------------------------------------------------------------------|
| HawkEye          | ✅ done       | Sets `revealed_chamber`                                            |
| BulletExtractor  | ✅ done       | Ejects current chamber, advances cursor                            |
| Silence          | ✅ done       | Sets `silence_target = opponent`                                   |
| Blocker          | ✅ done       | Sets `blocker_active_for = self`                                   |
| DoubleStrike     | ✅ done       | Sets `double_strike_for = self`                                    |
| Healer           | ✅ done       | +1 HP, capped at `STARTING_HP`                                     |
| RestoreBullet    | ❌ stub       | Returns `CardNotImplemented`                                       |
| Shuffler         | ❌ stub       | Same                                                               |
| CardThief        | ❌ stub       | Same                                                               |
| RandomInsight    | ❌ stub       | Same                                                               |
| LastChance       | ❌ stub       | Same                                                               |
| HandOfFate       | ❌ stub       | Same                                                               |

### Key design decisions worth knowing

- **All `Account<'info, T>` fields are wrapped in `Box<...>`** in every instruction context. This was required to fix a stack overflow (`SettleMatch` exceeded the 4 KB BPF stack by 648 B). Don't unwrap them.
- **RNG strategy** (in `init_match`): commit-reveal from both players + recent `SlotHashes` sysvar entry, mixed via `keccak::hashv` with domain separation tags (`b"GUN"`, `0xA1`/`0xB2` for hands). Deterministic, replay-verifiable, no oracle round-trip.
- **`resolve_actor()` helper**: signer is accepted if it equals `current_turn` (wallet) OR equals `current_profile.session_key` and `now < session_key_expiry`. This is how popup-less turns work.
- **Auto cylinder reload**: when all chambers are spent mid-match, `pull_trigger` reseeds with `(match_id, turn_number, slot)` and rebuilds the gun.
- **`settle_match` security**: PDA seeds enforce participant identity, status must be `Completed`, winner ATA owner/mint re-checked, vault is the SPL transfer authority via `[b"vault", bump]`, account is closed with `close = rent_refund` to prevent double-settle.
- **PlayerProfile stats**: ELO seeded at 1000.

---

## 6. Frontend — `apps/web`

### `useRolet` hook (`hooks/useRolet.ts`)
The full integration layer. Exports:

```ts
{
  program, connection, isEphemeral, sessionKey, busy,
  startSession,          // L1 popup → register_session_key + 0.005 SOL fund
  delegateMatch,         // STUB (PLAN_B) — no-op until TS SDK is wired
  pda: { match, profile, vault },
  initMatch,             // commit-reveal seeded; takes opponent + opp commit/secret
  playCard,              // takes currentTurnAuthority for current_profile PDA
  pullTrigger,           // takes currentTurnAuthority
  initProfile,           // SNS handle + durability_max
  fetchProfile,          // returns null if profile doesn't exist
  fetchVault,
  fetchMatch,
  subscribeMatch,        // websocket onAccountChange
  generateCommitReveal,
}
```

Plus `useToasts()` — a mock toast bus exported separately.

**Session key persistence:** stored in `localStorage` keyed by wallet pubkey (`rolet:session:<pubkey>`), expires_at honoured on load.

**Anchor 0.30 vs 0.32 quirk:** The frontend has `@coral-xyz/anchor 0.32.1` installed (transitive from pnpm); the Rust program is 0.30.1. Anchor 0.32 client uses `new Program(idl, provider)` (2-arg form) which auto-reads program ID from IDL `address` field. Our IDL has the address embedded. This works, but `program.coder.accounts.decode("matchState", ...)` is the camelCase form 0.32 prefers.

### Routes
- `/` — main menu, DUEL card links to /duel, two locked modes.
- `/profile` — enrollment form (if no profile) or stats card (if profile exists).
- `/duel` — Suspense wrapper → `DuelRouter` → `Lobby` (no `?match=`) or `ActiveDuel` (with `?match=<hex>`).

### `Lobby` create-match flow
1. Checks `fetchProfile()` on mount; if null → "▼ SETUP PROFILE FIRST" CTA links to `/profile`.
2. CREATE MATCH button:
   - Generates random `u64` matchId
   - Generates **ghost opponent Keypair** (placeholder for real matchmaking) + commit-reveal
   - Stashes ghost in `localStorage["rolet:ghost:<matchHex>"]`
   - Calls `initMatch(...)` → toast on success
   - Calls `delegateMatch(matchId)` (no-op stub)
   - `router.replace("/duel?match=<hex>")`

### `ActiveDuel`
- Subscribes to `MatchState` PDA via `subscribeMatch` (websocket).
- Decodes raw account bytes into UI-friendly shape (see `decodeMatch` function).
- Top bar shows match ID + ER status badge.
- Center: opponent SVG mask, chamber HUD, hand-cannon SVG (rotates to point at self/opponent).
- Bottom: vitals · 4-slot hand · firing solution.
- "▼ ARM WEAPON ▼" → `startSession(60*60)` — single popup, then turns are popup-free.
- Cursed terminal log mirrors toast events.

### Aesthetic system
- Tailwind v4 syntax: `@theme {}` for tokens (incl. `--animate-X` → auto-generates `animate-X` utility), `@utility name { }` for custom classes (`text-bleed`, `text-rust`, `border-rust`).
- Inline SVG turbulence filter for film-grain noise.
- Layered fixed overlays: noise (z-80) · scanlines (z-81) · red chromatic vignette (z-82) · flicker mask (z-83).
- Fonts: `Special_Elite` (display, distressed typewriter) + `VT323` (mono, CRT terminal).

---

## 7. Commands Cheat Sheet

### Daily dev loop
```bash
# Validator (already running — keep it up)
solana-test-validator --reset                         # in its own terminal

# Build (use --no-idl ALWAYS; anchor IDL gen has a proc_macro2 bug here)
cd /home/sametether/projects/rolet-web/apps/server
rm -f Cargo.lock                                       # force re-resolve if needed
anchor build --no-idl

# Deploy (do NOT use `anchor deploy` — it tries to rebuild IDL and fails)
solana program deploy \
  target/deploy/rolet.so \
  --program-id target/deploy/rolet-keypair.json \
  --url http://127.0.0.1:8899

# Vault bootstrap (only needed once, or after validator reset)
cp ../web/idl/rolet.json target/idl/rolet.json
npx tsx scripts/bootstrap-vault.ts

# Frontend
pnpm --filter web dev                                  # http://localhost:3000
```

### When validator is reset
1. `solana-test-validator --reset`
2. Re-deploy: `solana program deploy ...`
3. Delete `apps/server/migrations/.reward-mint.json` (cached old mint won't exist)
4. `npx tsx apps/server/scripts/bootstrap-vault.ts`

### Browser-side setup (Phantom on localnet)
1. Phantom → Settings → Developer Settings → enable Testnet Mode
2. Change Network → Custom RPC → `http://127.0.0.1:8899`
3. Get test SOL: `solana airdrop 10 <PHANTOM_PUBKEY> --url http://127.0.0.1:8899`

---

## 8. Next Steps (Prioritized)

### 🔴 Critical for hackathon
1. **Wire TS-side ER delegation.**
   - `pnpm --filter web add @magicblock-labs/ephemeral-rollups-sdk`
   - Replace the `delegateMatch` stub in `useRolet.ts` with actual SDK calls (`DelegateAccountIx`, etc.).
   - Switch `.env.local` `NEXT_PUBLIC_RPC_ENDPOINT` to `https://api.devnet.solana.com` (MagicBlock ER doesn't run on private localnet — devnet is the minimum).
   - Re-deploy the program to devnet (`solana program deploy ... --url https://api.devnet.solana.com`).
   - Bootstrap vault on devnet.
   - After delegation, ER endpoint is `https://devnet.magicblock.app`. The hook already routes there when `useRolet({ ephemeral: true })` is set.

2. **Implement undelegate flow.**
   - When `MatchState.status === "completed"` is observed in `subscribeMatch`, call MagicBlock's TS-side `commitAndUndelegate` to push final state back to L1.
   - Then call `settle_match` on L1 to distribute rewards.

3. **Implement remaining 6 cards** (`RestoreBullet`, `Shuffler`, `CardThief`, `RandomInsight`, `LastChance`, `HandOfFate`). All are stubs returning `CardNotImplemented`. The pattern is clear from `HawkEye` / `BulletExtractor`. Some need additional `MatchState` fields (e.g. `Shuffler` needs to track whether a reshuffle is pending; `CardThief` needs to mutate opponent's `CardHand`).

### 🟡 Important
4. **Real matchmaking.** Currently the "opponent" is a ghost keypair generated locally — the second player can never actually take a turn. Build a lobby where two real wallets meet, exchange commits via on-chain rendezvous account, and call `init_match` with both parties' contributions. Until then, only single-player demos work.

5. **Character NFT mint flow.** `PlayerProfile.character_nft` is stored but never validated. Build a mint instruction (probably leveraging Metaplex Core or Token Metadata) and gate `init_match` to require a character NFT held by the wallet. NFT durability decrement should burn or update the on-chain attribute.

6. **SNS resolution.** Right now `sns_domain` is a free-form string. Integrate `@bonfida/spl-name-service` on the frontend to resolve actual `.sol` domains; verify on-chain that the registered domain points to the wallet (or accept it as cosmetic).

### 🟢 Nice to have
7. **NFT durability repair / burn instruction.** When durability hits 0, what happens? Define repair cost or burn flow.
8. **ELO matchmaking.** ELO is tracked but not used. Match-rating + leaderboard route.
9. **Rate-limit `init_match` per wallet** to prevent spam-creating PDAs.
10. **2-hour session expiry refresh** without forcing re-popup.
11. **Tests.** Only `init_match` smoke test exists. Need full end-to-end ts-mocha suite covering settle_match, session key path, all card effects.
12. **Audit `settle_match`.** Currently `rent_refund: Signer<'info>` means anyone can settle. This is intentional (relayer-friendly), but verify economically that there's no griefing vector (e.g. settling immediately to lock in a stale state).
13. **Devnet RPC cost.** Anchor `subscribeMatch` uses websockets; for devnet free-tier RPC, this may rate-limit. Consider Helius or a paid devnet RPC.

---

## 9. Known Bugs / Gotchas

### Build chain
- **`anchor deploy` doesn't work** in this project — it tries to regenerate IDL and hits a `proc_macro2::Span::source_file` compile error in `anchor-syn`. Use `solana program deploy` directly.
- **`anchor build --no-idl` is mandatory.** Without `--no-idl`, the same `anchor-syn` bug fires.
- **Anchor `migrate`** tries to use `anchor.workspace.Rolet` which needs `target/idl/rolet.json` to exist. Either `cp apps/web/idl/rolet.json apps/server/target/idl/rolet.json` first, or use the standalone `scripts/bootstrap-vault.ts` (recommended).
- **`Cargo.lock`** sometimes needs to be deleted before `anchor build --no-idl` to force re-resolution after dep changes.

### Frontend
- **`@noble/hashes` v2.x** dropped the bare `./sha3` export. Always import as `@noble/hashes/sha3.js`. The import in `hooks/useRolet.ts` is correct; replicate this if you add other hashes.
- **`@coral-xyz/anchor` 0.32 client + 0.30 program**: Mostly compatible. Watch out for `program.account.matchState` (camelCase form) vs `program.account.MatchState` (older PascalCase).
- **`useSearchParams` in Next 16** must be inside a `<Suspense>` boundary. The duel page does this; if you add more, replicate the pattern.
- **`tsconfig.json` `paths`** has `"@/*": ["./*"]` (web app root). All imports use `@/hooks/useRolet`, `@/idl/rolet.json`, `@/components/SolanaProvider`, etc.
- **Tailwind v4 syntax** is different from v3. Custom utilities use `@utility name { }`, not `@layer utilities { .name { } }`. Animations registered in `@theme {}` automatically generate `animate-X` classes.
- **Phantom localnet support** requires Custom RPC in Developer Settings — there's no built-in "Localnet" entry in the network dropdown.

### MagicBlock SDK
- **DO NOT add `ephemeral-rollups-sdk` (Rust) back** unless you also upgrade Anchor to a version where the `dlp_api`/`solana-instruction` split is resolved (Anchor 0.31 was tried, didn't help; might need Anchor 0.32+ with all deps re-aligned).
- **The TS SDK** (`@magicblock-labs/ephemeral-rollups-sdk`) does not have this issue — the JS dep tree is independent. That's why PLAN_B moves delegation to the client.

### Legacy
- **`apps/server/src/`** holds dead Web2 socket.io code from before the FOCG pivot. The deps `express`, `socket.io`, `cors` in `apps/server/package.json` are unused. Safe to delete:
  ```bash
  rm -rf apps/server/src
  pnpm --filter @rolet/server remove express socket.io cors @types/express @types/cors tsx
  ```

---

## 10. File-Level Summary (key files only)

### `apps/server/programs/rolet/src/lib.rs` (~1000 lines)
The whole on-chain program. Sections in order:
- Imports + `declare_id!`
- Constants (`STARTING_HP`, `CHAMBER_COUNT`, etc.)
- `#[program] mod rolet { ... }` — 7 instructions
- `resolve_actor()` helper
- `build_gun()`, `deal_hand()`, `card_from_index()`, PRNG helpers
- `From<Chamber> for u8`
- L1 state: `PlayerProfile`, `PlayerStats`, `GameVault`
- Ephemeral state: `MatchState`, `MatchStatus`, `GunState`, `Chamber`, `CardHand`, `Card`
- Account contexts: `InitMatch`, `PlayCard`, `PullTrigger`, `SettleMatch`, `InitPlayerProfile`, `RegisterSessionKey`, `InitVault`
- Events: `MatchInitialized`, `CardPlayed`, `TriggerPulled`, `MatchSettled`, `ProfileCreated`, `VaultInitialized`, `SessionKeyRegistered`
- Error codes (~22 variants)

### `apps/web/idl/rolet.json`
Hand-written Anchor 0.30 spec IDL. Contains real SHA-256 discriminators (computed via Python). Spec version `0.1.0` (Anchor 0.30/0.31 format). Address field is the deployed program ID.

### `apps/web/idl/rolet_types.ts`
```ts
import idl from "./rolet.json";
export type Rolet = typeof idl;
export const ROLET_IDL = idl as Rolet;
```
That's it — substitutes for the auto-generated types file while `--no-idl` is in effect.

### `apps/web/hooks/useRolet.ts`
The integration brain. ~700 lines. See §6 for exported API.

### `apps/web/app/duel/page.tsx`
~1000 lines including the SVG hand-cannon, opponent mask, table, chamber HUD, card slots, action panel. The `Lobby` and `ActiveDuel` components are at the bottom.

### `apps/server/scripts/bootstrap-vault.ts`
Standalone Node script (run with `npx tsx`). Creates SPL mint, initializes vault PDA, funds treasury. Idempotent — checks if vault exists first. Caches the mint address in `migrations/.reward-mint.json` so subsequent runs reuse it.

---

## 11. Working Verification Checklist

Run these to confirm everything is healthy:

```bash
# Validator alive?
solana cluster-version --url http://127.0.0.1:8899
# → 3.1.14 (or whatever)

# Program deployed?
solana program show 2ePEUzCFcxD559Hy3irB2TGbYAwU2UD352sVj77QPrS7 --url http://127.0.0.1:8899
# → should show ProgramData

# Vault initialized?
# Get vault PDA via:
node -e "
const { PublicKey } = require('@solana/web3.js');
const [pda, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from('vault')],
  new PublicKey('2ePEUzCFcxD559Hy3irB2TGbYAwU2UD352sVj77QPrS7')
);
console.log(pda.toBase58(), bump);
"
# Then:
solana account <vault_pda> --url http://127.0.0.1:8899
# → should show ~232 bytes of data

# Treasury balance?
spl-token balance <reward_mint> --owner <vault_pda> --url http://127.0.0.1:8899

# Frontend up?
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/duel
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/profile
# → 200 200 200
```

---

## 12. Conversation Context (for the next AI)

The previous AI (Claude Opus 4.7 / Anthropic) collaborated with the user across ~12 phases:
1. Anchor data structures
2. Game loop instructions + RNG strategy
3. Settlement + tokenomics
4. Frontend foundation (layout, providers, main menu)
5. Duel page UI (mock state)
6. Web3 integration hook
7. Wire UI to blockchain
8. Profile + Vault initialization
9. Session keys + ER integration (PLAN_B detour due to SDK conflict)
10. Build + deploy automation

The user has been working in **Turkish** during the latter half of the conversation but explicitly requested this handoff in **English** for the next AI.

User context:
- Name/handle: sametether (homedir `/home/sametether`)
- Working in WSL2 Ubuntu
- Aware of Solana, Rust, React fundamentals
- Hackathon deadline pressure — prefers pragmatic decisions over architectural purity
- Comfortable taking destructive actions (resetting validator, etc.) but expects clear instructions

---

## 13. Quick Resume Guide

If you (the next AI) want to continue, here's the minimal mental model:

1. **The Rust program compiles, deploys, and runs.** Don't refactor it without good reason.
2. **The frontend renders all routes (200 OK on /, /duel, /profile).** End-to-end UI tested.
3. **Backend tested via on-chain verification, not browser.** The user must connect Phantom and click through the flow themselves — the previous AI couldn't do that part.
4. **The ER story is incomplete.** `delegateMatch` is a stub. To finish PLAN_B, install `@magicblock-labs/ephemeral-rollups-sdk` (TS), wire it into the `delegateMatch` callback, and switch to devnet.
5. **6 cards are stubs.** Implement them in `play_card` if time permits.
6. **No real matchmaking.** Single-wallet ghost-opponent demo flow only.

The fastest path to a hackathon-shippable demo:
- Implement TS-side ER delegation (item §8.1)
- Implement 2–3 of the missing cards (probably Shuffler + RestoreBullet + LastChance for variety)
- Record a screencast showing: Connect → Profile → Match → Arm → Several gasless turns → Win → Settle → Reward in wallet

Good luck. The architecture is sound; the remaining work is integration polish.

---

## 14. Lessons Learned (2026-05) — READ BEFORE TOUCHING ER

This section captures hard-won knowledge from the failed `feature/er-delegation`
branch and the live demo run. **Future AI sessions: read this before starting
any related work.** Saves several hours of dead ends.

### 14.1 ER delegation is BLOCKED — do not retry without a fix from MagicBlock

We attempted real MagicBlock ER delegation in `feature/er-delegation` branch.
Multiple combos failed with the **same root cause**: the `ephemeral-rollups-sdk`
crate has internal `solana-pubkey` / `solana-program` version fragmentation
that no Anchor version unifies.

| Combo tried                                | Failure mode                                          |
|--------------------------------------------|-------------------------------------------------------|
| Anchor 0.30.1 + SDK 0.11.2                 | `Address vs Pubkey` 16× E0308 (dlp_api split)         |
| Anchor 0.30.1 + SDK 0.12.0                 | Same                                                  |
| Anchor 0.30.1 + SDK 0.13.0                 | Same                                                  |
| Anchor 0.31.1 + SDK 0.13.0                 | `as_array()` not found on Pubkey                      |
| Anchor 0.31.1 + SDK 0.11.2                 | `__Pubkey vs magicblock_magic_program_api::Pubkey`    |
| Anchor 0.32.1 + SDK 0.11.2 (skill recommends) | Same `__Pubkey` mismatch                            |
| Anchor 0.32.1 + SDK 0.13.0                 | Same                                                  |
| **Manual CPI (no SDK)** validator: None    | `Invalid account owner` from delegation program      |
| **Manual CPI (no SDK)** validator: DEFAULT | Same                                                  |

The manual CPI route requires `#[ephemeral]` macro runtime hooks — those are
inside the SDK. So no SDK = no delegation. Confirmed by the official MagicBlock
dev skill (`/tmp/magicblock-dev-skill/skill/delegation.md`) which insists on
`ephemeral-rollups-sdk` 0.11.2 + Anchor 0.32.1 — but we proved that combo
**doesn't actually compile** in 2026-05.

**Verdict:** ER delegation is blocked on **MagicBlock fixing their crate
dependency tree**. Likely needs Discord support / GitHub issue. Do NOT spend
more cycles trying random version combos. The TS SDK is fine and stays
installed; only the Rust side is broken.

When MagicBlock ships a clean SDK, the work is straightforward (~2-3 hrs):
- Add `ephemeral-rollups-sdk` dep
- Add `#[ephemeral]` to `mod rolet`
- Add `#[delegate]` to `DelegateMatchState` context
- Replace `delegateMatch()` no-op stub with real call to rolet's new ix
- Add `commitAndUndelegate` via `MagicIntentBundleBuilder` in pull_trigger
- See `feature/er-delegation` branch for the half-finished code (don't merge,
  use as reference).

### 14.2 Operational gotchas

- **`gh` CLI requires sudo** (not pre-installed). User must install themselves.
- **Phantom on devnet:** Settings → Developer → Custom RPC → `http://127.0.0.1:8899`
  for localnet OR pick "Devnet" for mainnet-style. The wallet's address is the
  same on every cluster but balances are separate.
- **Helius free tier blocks WebSocket.** `Connection._wsOnError` shows up in
  Next 16 dev devtools as a red error overlay. Harmless — HTTP polling
  fallback every 1.5s in `ActiveDuel` covers state updates. To suppress
  visually, run `pnpm build && pnpm start` instead of `pnpm dev`. Do NOT
  rewrite `confirmTransaction` — the noise is cosmetic.
- **`git checkout v0.1-working-demo` does NOT cleanly restore Cargo.lock.**
  Expect minor solve drift on next `cargo build`. Cosmetic, ignore.
- **`anchor deploy` is BROKEN.** Use `solana program deploy ...` directly with
  `--url` flag. Anchor's deploy command tries to rebuild IDL → hits
  `proc_macro2::Span::source_file` bug.
- **`anchor build --no-idl` is mandatory.** Same proc_macro2 bug fires
  without `--no-idl`.

### 14.3 Wallet identity model

- **CLI wallet** (`~/.config/solana/id.json` → `9uJcwroPnjEAZPEv5nMuWX2df6vGptNUC2aGaNV6Pw2o`):
  - Funded from user's Phantom transfer (5 SOL, then 1 SOL more)
  - Pays for program deploy + vault bootstrap
  - **Owns program upgrade authority** — DO NOT LOSE this keypair
  - Backed up to `~/.rolet-checkpoint-v0.1/`
- **User's Phantom wallet** (different pubkey, on devnet):
  - The actual player
  - Holds the 1 $ROLET they won
  - Has session keys cached in localStorage
  - User must keep ~0.05 SOL in it for popups + funding

### 14.4 Active runtime decisions (in code, may be tuned)

| Decision                  | Where                                  | Value             |
|---------------------------|----------------------------------------|-------------------|
| Ghost AI target ratio     | `app/duel/page.tsx` `useEffect`        | 30% self / 70% you|
| Ghost "thinking" delay    | Same                                   | 1500 ms           |
| Polling interval          | `app/duel/page.tsx` `setInterval`      | 1500 ms           |
| Session duration max      | `lib.rs` `register_session_key`        | 24 hours          |
| Session SOL fund          | `useRolet.ts` `startSession`           | 0.005 SOL         |
| Ghost SOL fund (lobby)    | `useRolet.ts` `setupGhost`             | 0.02 SOL          |
| Starting HP               | `lib.rs` `STARTING_HP`                 | 4                 |
| Chamber load              | `lib.rs` constants                     | 5 Live + 3 Blank  |
| Reward per win            | bootstrap script                       | 1 $ROLET (10^6)   |
| Initial treasury          | bootstrap script                       | 1000 $ROLET       |

### 14.5 Currently deployed program has dead code

The devnet binary (program `2ePEUz...`) was last deployed during the
`feature/er-delegation` branch. It contains the `delegate_match_state` ix
that frontend never calls. Harmless dead weight but worth knowing if
debugging program logs.

To re-deploy a clean binary (matches current main branch source exactly):

```bash
cd apps/server
rm -f Cargo.lock && anchor build --no-idl
solana program deploy target/deploy/rolet.so \
  --program-id target/deploy/rolet-keypair.json \
  --url https://api.devnet.solana.com
```

But this is optional — the dead ix is unreachable from the frontend.

### 14.6 What's been demo-tested end-to-end on devnet

- Profile enrollment ✓
- Lobby create + ghost setup ✓
- Match init with commit-reveal RNG ✓
- Session key arming + 0.005 SOL fund ✓
- Popup-less trigger pulls (3+ verified) ✓
- Ghost auto-play (multiple turns) ✓
- Card playing: Shuffler, LastChance (1HP gate works), DoubleStrike ✓
- Match completion (HP→0) ✓
- Settle + reward transfer (1 $ROLET in wallet) ✓
- Treasury accounting (999/1000 + matches_settled=1) ✓

NOT yet demo-tested:
- 6 stub cards: RestoreBullet, Shuffler, CardThief, RandomInsight, HandOfFate
  (Shuffler IS implemented per logs, just RestoreBullet/etc untested)
- Real 2-player flow (only ghost so far)
- Multiple matches in same session
- Session key expiry handling

### 14.7 Brief for the next AI session

When resuming, the user will say something like:
> "ROLET projesi, ROADMAP'te <X> branch'i, başla."

Read in this order:
1. `README.md` (top-level)
2. `ROADMAP.md` (what to do, kuralset)
3. This section (§14, what NOT to do)
4. `CHECKPOINT-v0.1.md` (current frozen state)
5. Only if needed: full HANDOFF.md (architecture detail)

Then start the requested branch. Don't re-explain the project to the user;
they know it. Match their context level.
