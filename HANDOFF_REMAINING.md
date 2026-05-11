# ROLET — Remaining Work Plan (Hand-off for Sonnet)

Hackathon deadline: **May 12 2026**. Demo video + Colosseum submission deferred to evening — do NOT touch those.

Repo: `/home/samet/Projeler/rolet-web/`. Web app: `apps/web/`.
Run dev: `cd apps/web && pnpm dev` (port 3001). Build: `pnpm build`.
Push to `main` triggers Vercel deploy automatically.

Code style rules:
- TypeScript strict. Match existing files' patterns.
- Tailwind v4 utility classes. `crt-text`, `crt-frame`, `crt-grain` already exist in `globals.css`.
- `motion/react` (framer-motion v12) already installed.
- No new dependencies unless explicitly listed below.
- Keep commits atomic per feature. Co-author: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.

---

## Priority 1 — Sound Effects (1–2 h)

Goal: every gameplay event has a sound. Mute toggle + remembered preference.

### New files
- `apps/web/hooks/useSound.ts` — hook + global player.
- `apps/web/public/sounds/` — directory for `.mp3`/`.ogg` assets.

### Sounds to source
Use `freesound.org` or `kenney.nl/assets/sci-fi-sounds` (CC0). Download via curl, normalize to ~96 kbps mono OGG. Keep each file under 40 KB.

| key             | trigger                                | suggested feel        |
| --------------- | -------------------------------------- | --------------------- |
| `triggerCock`   | gun picked up (gunHeld false → true)   | metallic cock         |
| `gunshotLive`   | `firing === 'live'`                    | sharp revolver shot   |
| `clickBlank`    | `firing === 'blank'`                   | dry mechanical click  |
| `playerHit`     | `playerHp` decreases                   | wet thud + impact     |
| `cardPlay`      | `playCard` success                     | paper swoosh          |
| `uiSelect`      | card selected / target switched        | soft beep             |
| `matchWin`      | `decoded.status === 'completed'` + win | low industrial drone  |
| `matchLose`     | same as above but loss                 | dark sting            |

### Hook API
```ts
// apps/web/hooks/useSound.ts
export type SoundKey = 'triggerCock' | 'gunshotLive' | 'clickBlank'
  | 'playerHit' | 'cardPlay' | 'uiSelect' | 'matchWin' | 'matchLose';

export function useSound(): {
  play: (key: SoundKey, opts?: { volume?: number }) => void;
  muted: boolean;
  toggleMute: () => void;
};
```
Implementation: pre-create `HTMLAudioElement` per key (cached). Mute state in `localStorage` key `rolet:muted`. Volume default 0.6.

### Wire-up locations in `apps/web/app/duel/page.tsx`
- `ActiveDuel`:
  - `useEffect` on `gunHeld` rising edge → `play('triggerCock')`
  - `handlePullTrigger`: after deciding `isLive`, `play(isLive ? 'gunshotLive' : 'clickBlank')`
  - Existing `useEffect` that detects `playerHp` drop → `play('playerHit')`
  - `handlePlayCard`: after `await rolet.playCard(...)` returns truthy → `play('cardPlay')`
  - `setSelectedSlot` and `setTarget` callbacks → `play('uiSelect')`
  - `useEffect` watching `decoded.status === 'completed'` (once) → win/lose by comparing `decoded.winner` to `youKey`.

### Mute button
Top bar (next to status indicator on the right):
```tsx
<button onClick={toggleMute} className="text-[10px] tracking-[0.4em] text-rust hover:text-red-500 crt-text">
  {muted ? '🔇 MUTED' : '🔊 ON'}
</button>
```

### Acceptance
- All 8 events make a sound.
- Mute persists across reload.
- No CORS errors in console.
- Files committed to `public/sounds/`.

---

## Priority 2 — Landing Page Redesign (2–3 h)

File: `apps/web/app/page.tsx`. Keep the CRT terminal aesthetic. Don't break the existing wallet button.

### Sections (in order)
1. **Hero** — full-screen
   - Big title `ROLET` (font-display, ~clamp(5rem, 14vw, 12rem), `text-bleed` + `animate-title`).
   - Tagline: `// ON-CHAIN RUSSIAN ROULETTE · PROVABLY FAIR · SOLANA`
   - CTA buttons: `▶ ENTER ARENA` (→ `/duel`) and `▒ CREATE PROFILE` (→ `/profile`).
   - Background: subtle 3D revolver from `DuelArena3D` is too heavy — use a single static GLB render via `<Canvas>` with no animation, OR a procedural SVG bullet ring rotating. Keep it lightweight.
   - Overlay: scanlines + grain (`crt-frame`/`crt-grain` already defined).

2. **How It Works** — 3-step grid
   - `01 CONNECT` (wallet + profile)
   - `02 STAKE` ($ROLET into vault)
   - `03 SURVIVE` (12 tactical cards + 8 chambers)
   - Each step: large numeral, short title, 1-line blurb, small icon.

3. **Features grid** — 4 cards (2×2)
   - On-chain randomness (Anchor + slot hashes)
   - Session keys → gasless turns (popup count: 1)
   - SNS Identity (`yourname.sol` shown in arena)
   - 12 tactical cards × 8 chambers — Buckshot-style strategy

4. **Tech strip** — single row of monospace badges
   - `SOLANA · ANCHOR 0.30 · NEXT 16 · R3F · DEVNET · COLOSSEUM 2026`

5. **Footer**
   - Links: GitHub (https://github.com/SmtDcs/rolet-web), Twitter (placeholder), Docs (placeholder)
   - Hackathon badge: `// COLOSSEUM FRONTIER · SUBMISSION 2026`
   - Wallet status: still shows public key when connected.

### Style notes
- Wrap every section in `crt-frame` if it contains a panel.
- Use `crt-text` on all uppercase labels.
- Animations limited to: title shake, blood pulse on CTA, subtle float on numerals.
- No new dependencies. No new fonts.

### Acceptance
- Hero, How It Works, Features, Tech, Footer all present.
- ENTER ARENA button routes to `/duel`.
- Looks consistent with the existing CRT aesthetic from `/duel`.
- Mobile: stacks vertically, no horizontal scroll.

---

## Priority 3 — Match History on Profile (1 h)

File: `apps/web/app/profile/page.tsx`.

### Add `fetchMatchHistory` to `useRolet` hook
File: `apps/web/hooks/useRolet.ts`. Add a `useCallback`:
```ts
const fetchMatchHistory = useCallback(async (limit = 10) => {
  if (!programL1 || !wallet.publicKey) return [];
  const me = wallet.publicKey;
  // playerOne is at offset 8 (after 8-byte discriminator).
  // playerTwo is at offset 40 (8 + 32).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountClient = (programL1.account as any).matchState;
  const [asPlayerOne, asPlayerTwo] = await Promise.all([
    accountClient.all([{ memcmp: { offset: 8,  bytes: me.toBase58() } }]),
    accountClient.all([{ memcmp: { offset: 40, bytes: me.toBase58() } }]),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = [...asPlayerOne, ...asPlayerTwo] as any[];
  // Dedup by pubkey
  const seen = new Set<string>();
  const unique = all.filter((m) => {
    const k = m.publicKey.toBase58();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Sort by matchId desc (matchId is Date.now())
  unique.sort((a, b) => (b.account.matchId as BN).cmp(a.account.matchId as BN));
  return unique.slice(0, limit);
}, [programL1, wallet.publicKey]);
```
Export it from the hook return.

### UI on profile page
Add below existing profile stats:
```tsx
<section className="border crt-frame crt-grain border-rust/60 bg-black/70 p-4 mt-6">
  <div className="text-[10px] tracking-[0.4em] text-rust crt-text mb-3">// RECENT MATCHES</div>
  {history.length === 0 && <div className="text-[11px] text-zinc-500">no matches yet</div>}
  {history.map((m) => {
    const won = m.account.winner?.toBase58() === wallet.publicKey?.toBase58();
    const oppKey = m.account.playerOne.toBase58() === wallet.publicKey?.toBase58()
      ? m.account.playerTwo : m.account.playerOne;
    return (
      <div key={m.publicKey.toBase58()} className="flex justify-between items-center py-1.5 border-b border-rust/30 text-[11px] crt-text">
        <span className={won ? "text-red-400" : "text-zinc-500"}>
          {won ? "✓ WIN" : "✗ LOSS"}
        </span>
        <span className="text-zinc-400">vs {oppKey.toBase58().slice(0, 6)}…</span>
        <span className="text-zinc-600">
          {new Date(Number(m.account.matchId)).toLocaleDateString()}
        </span>
      </div>
    );
  })}
</section>
```

Fetch on mount with the existing profile useEffect.

### Acceptance
- Last 10 matches show with WIN/LOSS, opponent prefix, date.
- Empty state: `no matches yet`.
- No console errors when wallet not connected.

---

## Priority 4 — Navbar + Footer (30 min)

### New file: `apps/web/components/Nav.tsx`
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "HOME" },
  { href: "/duel", label: "ARENA" },
  { href: "/profile", label: "PROFILE" },
  { href: "/leaderboard", label: "LEADERBOARD" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 py-3 border-b border-rust/40 bg-black/60 backdrop-blur-sm">
      <Link href="/" className="font-display text-xl text-bleed crt-text">ROLET</Link>
      <div className="flex gap-6">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`text-[10px] tracking-[0.4em] crt-text ${
              path === l.href ? "text-red-400" : "text-rust hover:text-red-500"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </div>
      {/* Wallet button slot — reuse existing component if mounted elsewhere */}
    </nav>
  );
}
```

### Footer: same file or `Footer.tsx`
```tsx
export function Footer() {
  return (
    <footer className="border-t border-rust/30 px-6 py-3 text-[9px] tracking-[0.4em] text-zinc-600 flex justify-between crt-text">
      <span>// COLOSSEUM FRONTIER · 2026</span>
      <span>github.com/SmtDcs/rolet-web</span>
    </footer>
  );
}
```

### Where to mount
- DO NOT mount on `/duel` — duel page has its own fixed top bar.
- Mount in `layout.tsx` conditionally OR in individual pages (`/`, `/profile`, `/leaderboard`).

### Acceptance
- Nav visible on home, profile, leaderboard.
- Active route highlighted red.
- Duel page unaffected.

---

## After Everything is Done

Tell the user:
- All 4 priorities complete.
- Build passes (`pnpm build`).
- Suggest they test in browser, then it's time for the demo video.

Do NOT touch:
- `apps/server/` (Rust program — frozen).
- `apps/web/idl/` (auto-generated).
- `apps/web/components/DuelArena3D.tsx` (recently stabilized — don't regress).
- `apps/web/components/HandRack3D.tsx` (recently stabilized).
- `apps/web/hooks/useRolet.ts` except adding `fetchMatchHistory`.
