# ROLET — Hackathon Pitch

## Problem

On-chain games are either:
- **Fake** — "blockchain game" with a centralized server running the actual logic
- **Slow** — real on-chain games require a wallet popup for every action, killing UX
- **Unfair** — single-player RNG is manipulable by whoever controls the seed

## Solution

ROLET is a **Fully On-Chain Game (FOCG)** that solves all three:

| Problem | ROLET's answer |
|---------|---------------|
| Centralized logic | Every game state mutation is a Solana instruction. No server. |
| Wallet popup fatigue | Session keys: one approval, then gasless turns. |
| Manipulable RNG | Commit-reveal: both players commit a secret before the match seeds. |

## How it works (technical)

**1. Lobby PDA rendezvous**  
Host calls `open_lobby` → on-chain PDA created (`seeds: ["lobby", match_id]`).  
Guest calls `join_lobby` → submits `guest_commit = keccak256(secret)` + secret on-chain.  
Host calls `init_match` → both secrets combined → RNG seed locked.

**2. Commit-reveal fairness**  
`rng_seed = hash(host_secret ‖ guest_secret)`  
Neither player can bias the outcome: changing their secret changes the hash, and they committed before seeing the other's.

**3. Session keys**  
`register_session_key` stores an ephemeral pubkey on the `PlayerProfile` PDA with an expiry.  
Turns are signed by the session keypair locally — no wallet popups mid-game.

**4. GameVault treasury**  
`$ROLET` SPL tokens live in a PDA vault. `settle_match` transfers to the winner. No manual custody.

## What's built

- ✅ Full Anchor program (Rust): `init_match`, `pull_trigger`, `play_card`, `settle_match`, `register_session_key`, `init_player_profile`, `init_vault`, `open_lobby`, `join_lobby`, `close_lobby`
- ✅ 12 tactical cards with on-chain effects
- ✅ Real 2-player matchmaking (Lobby PDA)
- ✅ Session keys (gasless turns)
- ✅ $ROLET SPL token payout
- ✅ CRT/industrial aesthetic frontend
- ✅ Live on Solana Devnet

## Demo

[`rolet-web-server.vercel.app`](https://rolet-web-server.vercel.app) · [`github.com/SmtDcs/rolet-web`](https://github.com/SmtDcs/rolet-web)

## Roadmap

| Feature | Status |
|---------|--------|
| Character NFT (Metaplex Core) + durability | Next |
| MagicBlock ER delegation (sub-second latency) | Blocked on SDK dep conflict; waiting for resolution |
| Leaderboard / ELO | Planned |
| Match replay (deterministic RNG) | Planned |

## Why Solana?

- Fast enough for turn-based games on L1 (~400ms)
- Session keys via account model (no EIP-like proposal needed)
- Anchor makes PDA-heavy programs ergonomic
- Helius RPC for reliable devnet access
- MagicBlock ER path exists for future sub-second finality

---

*ROLET — pull the trigger, trust the chain.*
