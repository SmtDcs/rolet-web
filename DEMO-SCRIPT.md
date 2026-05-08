# ROLET — Demo Recording Script

**Target length:** 3–4 minutes  
**Setup:** Two browser windows side by side (Host = left, Guest = right).  
Both wallets on Devnet. Both wallets have ≥0.1 SOL for fees.

---

## Pre-recording checklist

- [ ] Both wallets airdropped devnet SOL (`solana airdrop 1 <pubkey> --url devnet`)
- [ ] Both wallets enrolled (visited /profile, created PlayerProfile)
- [ ] Vault has $ROLET balance (bootstrap-vault.ts run)
- [ ] Browser at 1280×800 or wider — both windows visible
- [ ] Screen recording started, mic ready

---

## Script

### [0:00 – 0:20] Hook

**Show:** Game landing page. CRT aesthetic, scanlines, the revolver.

**Say:**
> "This is ROLET — a fully on-chain PvP Russian Roulette built on Solana.
> No server. No database. Every chamber, every card effect, every payout
> lives on-chain. Let me show you a live match on devnet."

---

### [0:20 – 0:45] Host creates lobby

**Show:** Left window → `/duel` → click **CREATE LOBBY**

- Wallet popup appears → approve (open_lobby transaction)
- Page redirects to `?lobby=<id>` → shows "Waiting for opponent…"
- Copy the invite link

**Say:**
> "Player one opens a lobby. A Lobby PDA is created on Solana — it holds
> a cryptographic commitment to their secret. They share the invite link."

---

### [0:45 – 1:10] Guest joins

**Show:** Right window → paste invite URL → page loads

- Guest sees "Join match" → click **JOIN**
- Wallet popup → approve (join_lobby transaction)
- Guest screen shows "Waiting for host to launch…"

**Say:**
> "Player two joins. They submit their own secret commitment on-chain.
> Neither player can see the other's secret yet."

---

### [1:10 – 1:35] Host launches — commit-reveal

**Show:** Left window — "Guest joined!" banner appears
- Click **LAUNCH MATCH** → wallet popup → approve (init_match + close_lobby)
- Both windows redirect to the active duel

**Say:**
> "The host launches. Both secrets are now revealed and combined on-chain
> to seed the chamber RNG — cryptographically fair, neither player could
> predict it. The Lobby PDA is closed, rent returned."

---

### [1:35 – 2:10] ARM WEAPON — session keys

**Show:** Left window → click **ARM WEAPON**
- One wallet popup (register_session_key) → approve
- "Armed" status appears

**Say:**
> "Session keys eliminate wallet popups for every turn. One approval
> at the start — then the session keypair signs locally. No friction,
> Web2 speed on top of L1."

*Do the same on the right window quickly.*

---

### [2:10 – 3:00] Gameplay — cards + trigger pulls

**Show:** Left window — it's Host's turn
- Play **HawkEye** card → chamber revealed (live or blank indicator)
- Pull trigger → HP drops or blank fires
- Right window — Guest's turn
- Guest plays **BulletExtractor** → ejects current chamber
- Guest pulls trigger on host

**Say:**
> "Twelve tactical cards. HawkEye peeks at the next chamber.
> BulletExtractor ejects it. DoubleStrike doubles the next live hit.
> Every card call is a signed Solana transaction — verifiable on-chain."

*(Play 3–4 more turns, mix card plays and trigger pulls. Keep energy up.)*

---

### [3:00 – 3:30] Settle — on-chain payout

**Show:** Final trigger pull → HP hits 0 → winner screen
- "CLAIM REWARD" button appears
- Click → wallet popup (settle_match) → approve
- `$ROLET` balance increases in wallet

**Say:**
> "Winner claims $ROLET from the GameVault treasury PDA. Loser gets
> nothing. All of this — from match creation to payout — happened
> on Solana. No backend ever touched game state."

---

### [3:30 – 3:50] Outro

**Show:** Solana Explorer — show the settle_match transaction, click through
the instruction data.

**Say:**
> "ROLET is a Fully On-Chain Game on Solana. Commit-reveal fairness,
> session-key gasless turns, 2-player PvP via Lobby PDA rendezvous.
> Source on GitHub. Try the live demo on devnet."

**End screen:** `github.com/SmtDcs/rolet-web` + `https://rolet-web-server.vercel.app`

---

## Editing notes

- Trim wallet approval screens to ~2 seconds each (they're boring)
- Add captions for on-chain terms (PDA, session key) the first time they appear
- Background music: lo-fi / industrial, low volume
- Export at 1080p for submission
