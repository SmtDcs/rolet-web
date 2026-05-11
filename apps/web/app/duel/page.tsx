// app/duel/page.tsx
"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { useRolet, useToasts, type RoletCard } from "@/hooks/useRolet";

const DuelArena3D = dynamic(() => import("@/components/DuelArena3D"), { ssr: false });

// ============================================================
// Domain types
// ============================================================
type Chamber = "live" | "blank" | "empty";
type Target = "self" | "opponent";

const CARD_GLYPH: Record<RoletCard, string> = {
  restoreBullet: "▲",
  hawkEye: "◉",
  silence: "✕",
  blocker: "▣",
  bulletExtractor: "↧",
  shuffler: "↻",
  doubleStrike: "✦",
  healer: "+",
  cardThief: "⌖",
  randomInsight: "?",
  lastChance: "!",
  handOfFate: "✧",
};

const CARD_LABEL: Record<RoletCard, string> = {
  restoreBullet: "RestoreBullet",
  hawkEye: "HawkEye",
  silence: "Silence",
  blocker: "Blocker",
  bulletExtractor: "BulletExtractor",
  shuffler: "Shuffler",
  doubleStrike: "DoubleStrike",
  healer: "Healer",
  cardThief: "CardThief",
  randomInsight: "RandomInsight",
  lastChance: "LastChance",
  handOfFate: "HandOfFate",
};

const CARD_BLURB: Record<RoletCard, string> = {
  restoreBullet: "Reload a spent chamber.",
  hawkEye: "Reveal the next chamber.",
  silence: "Mute the opponent's hand for one turn.",
  blocker: "Negate the next bullet you take.",
  bulletExtractor: "Eject the current chamber.",
  shuffler: "Re-shuffle the loaded chambers.",
  doubleStrike: "Your next live shot deals 2 HP.",
  healer: "Restore 1 HP.",
  cardThief: "Steal a random card.",
  randomInsight: "Reveal a random unfired chamber.",
  lastChance: "At 1 HP — skip opponent's next turn.",
  handOfFate: "Re-roll the current chamber.",
};

// ============================================================
// Decoders — translate raw on-chain MatchState into UI state
// ============================================================
type DecodedMatch = {
  playerOneHp: number;
  playerTwoHp: number;
  currentTurn: string;
  playerOne: string;
  playerTwo: string;
  chambers: Chamber[];
  currentChamber: number;
  liveCount: number;
  blankCount: number;
  yourHand: (RoletCard | null)[];
  status: "awaitingOpponent" | "active" | "completed" | "abandoned";
  silencedYou: boolean;
  blockerOnYou: boolean;
};

const ANCHOR_CARD_KEYS: RoletCard[] = [
  "restoreBullet", "hawkEye", "silence", "blocker", "bulletExtractor",
  "shuffler", "doubleStrike", "healer", "cardThief", "randomInsight",
  "lastChance", "handOfFate",
];

function decodeChamber(raw: { empty?: object; blank?: object; live?: object }): Chamber {
  if (raw.live) return "live";
  if (raw.blank) return "blank";
  return "empty";
}

function decodeCard(opt: { [k in RoletCard]?: object } | null): RoletCard | null {
  if (!opt) return null;
  const key = ANCHOR_CARD_KEYS.find((k) => opt[k]);
  return key ?? null;
}

function decodeStatus(raw: Record<string, object>): DecodedMatch["status"] {
  if (raw.active) return "active";
  if (raw.completed) return "completed";
  if (raw.abandoned) return "abandoned";
  return "awaitingOpponent";
}

function decodeMatch(state: any, you: string | null): DecodedMatch | null {
  if (!state) return null;
  const playerOne = state.playerOne.toBase58();
  const playerTwo = state.playerTwo.toBase58();
  const youArePlayerOne = you === playerOne;

  const chambers: Chamber[] = state.gun.chambers.map(decodeChamber);
  const liveCount = chambers.filter((c) => c === "live").length;
  const blankCount = chambers.filter((c) => c === "blank").length;

  const handAccount = youArePlayerOne ? state.playerOneCards : state.playerTwoCards;
  const yourHand = handAccount.slots.map((s: any) => decodeCard(s));

  const silenceTarget = state.silenceTarget?.toBase58?.() ?? null;
  const blockerFor = state.blockerActiveFor?.toBase58?.() ?? null;

  return {
    playerOne,
    playerTwo,
    playerOneHp: state.playerOneHp,
    playerTwoHp: state.playerTwoHp,
    currentTurn: state.currentTurn.toBase58(),
    chambers,
    currentChamber: state.gun.currentChamber,
    liveCount,
    blankCount,
    yourHand,
    status: decodeStatus(state.status),
    silencedYou: silenceTarget === you,
    blockerOnYou: blockerFor === you,
  };
}

// ============================================================
// Default export — Suspense boundary required for useSearchParams
// ============================================================
export default function DuelPage() {
  return (
    <Suspense fallback={<DuelLoading />}>
      <DuelRouter />
    </Suspense>
  );
}

function DuelLoading() {
  return (
    <main className="relative min-h-screen flex items-center justify-center">
      <div className="text-[10px] tracking-[0.5em] text-rust animate-pulse">
        // TUNING SIGNAL…
      </div>
    </main>
  );
}

/**
 * Reads URL params:
 *  ?match=<hex>  → ActiveDuel
 *  ?lobby=<hex>  → HostWaiting (host polling for guest)
 *  ?join=<hex>   → GuestLobby (guest joins + waits for host to launch)
 *  (none)        → CreateMatch
 */
function DuelRouter() {
  const search = useSearchParams();
  const matchHex = search.get("match");
  const lobbyHex = search.get("lobby");
  const joinHex = search.get("join");
  const autoJoin = search.get("auto") === "true";

  const matchId = useMemo(() => {
    if (!matchHex) return null;
    try { return new BN(matchHex, 16); } catch { return null; }
  }, [matchHex]);

  const lobbyMatchId = useMemo(() => {
    const hex = lobbyHex ?? joinHex;
    if (!hex) return null;
    try { return new BN(hex, 16); } catch { return null; }
  }, [lobbyHex, joinHex]);

  if (matchId) return <ActiveDuel matchId={matchId} />;
  if (lobbyMatchId && lobbyHex) return <HostWaiting matchId={lobbyMatchId} />;
  if (lobbyMatchId && joinHex) return <GuestLobby matchId={lobbyMatchId} autoJoin={autoJoin} />;
  return <Lobby />;
}

// ============================================================
// Active duel — UI when a real on-chain match exists
// ============================================================
function ActiveDuel({ matchId }: { matchId: BN }) {
  const wallet = useWallet();
  const rolet = useRolet({ ephemeral: true });
  const toasts = useToasts();

  const [state, setState] = useState<any>(null);
  const [target, setTarget] = useState<Target>("opponent");
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([
    "// signal acquired — ER://magicblock-edge",
    "// awaiting wallet handshake…",
  ]);

  const youKey = wallet.publicKey?.toBase58() ?? null;
  const decoded = useMemo(() => decodeMatch(state, youKey), [state, youKey]);

  const turnIsYours =
    !!decoded && !!youKey && decoded.currentTurn === youKey && decoded.status === "active";

  // Live MatchState — websocket subscribe + HTTP poll fallback.
  // Helius free tier sometimes blocks WS; without the poll, UI stays frozen
  // while txs land on chain. Poll every 1.5s — cheap and within free quota.
  useEffect(() => {
    if (!rolet.program) return;
    let unsub = () => {};
    let alive = true;
    (async () => {
      const initial = await rolet.fetchMatch(matchId);
      if (alive && initial) {
        setState(initial);
        setLog((l) => ["// match snapshot loaded", ...l].slice(0, 24));
      }
      unsub = rolet.subscribeMatch(matchId, (next) => {
        if (!alive) return;
        setState(next);
        setLog((l) => ["// state delta received", ...l].slice(0, 24));
      });
    })();
    const poll = setInterval(async () => {
      if (!alive) return;
      try {
        const fresh = await rolet.fetchMatch(matchId);
        if (alive && fresh) setState(fresh);
      } catch { /* swallow RPC errors between polls */ }
    }, 1500);
    return () => {
      alive = false;
      unsub();
      clearInterval(poll);
    };
  }, [rolet, matchId]);

  // Mirror toast events into the cursed terminal log.
  useEffect(() => {
    if (!toasts.length) return;
    const latest = toasts[toasts.length - 1];
    const tag =
      latest.level === "error" ? "!!" : latest.level === "success" ? ">>" : "..";
    setLog((l) => [`${tag} ${latest.message}`, ...l].slice(0, 24));
  }, [toasts]);

  // When a match completes inside the ER, push final state back to L1 so
  // settle_match becomes callable. Runs once per terminal status flip.
  const [committed, setCommitted] = useState(false);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!decoded || decoded.status !== "completed" || committed) return;
    setCommitted(true);
    setLog((l) => ["// match over — committing state to L1…", ...l].slice(0, 24));
    rolet.commitAndUndelegateMatch(matchId);
  }, [decoded, committed, rolet, matchId]);

  // Ghost auto-play. Triggers when the current turn belongs to the ghost
  // opponent. We deliberately skip `rolet` from the dep array because the
  // hook reconstructs that object every render, which would cause the
  // cleanup to clear our setTimeout before it fires. The methods we use
  // (ghostPullTrigger / fetchMatch) are stable via useCallback inside the
  // hook, so reading them from a ref each tick is safe.
  const ghostFiringRef = useRef(false);
  const rolet_ = useRef(rolet);
  rolet_.current = rolet;
  const setStateRef = useRef(setState);
  setStateRef.current = setState;

  useEffect(() => {
    if (!decoded || decoded.status !== "active" || !youKey) return;
    if (ghostFiringRef.current) return;
    if (decoded.currentTurn === youKey) return;

    const matchHex = matchId.toString(16);
    const raw = window.localStorage.getItem(`rolet:ghost:${matchHex}`);
    if (!raw) return;
    let ghostKp: Keypair;
    try {
      const parsed = JSON.parse(raw) as { keypair: number[] };
      ghostKp = Keypair.fromSecretKey(Uint8Array.from(parsed.keypair));
    } catch {
      return;
    }
    if (decoded.currentTurn !== ghostKp.publicKey.toBase58()) return;

    ghostFiringRef.current = true;
    setLog((l) => ["// 👻 ghost is taking aim…", ...l].slice(0, 24));
    const timer = setTimeout(async () => {
      try {
        const targetSelf = Math.random() < 0.3;
        await rolet_.current.ghostPullTrigger(matchId, ghostKp, targetSelf);
        const fresh = await rolet_.current.fetchMatch(matchId);
        if (fresh) setStateRef.current(fresh);
      } catch { /* ghost turn failed; next state poll will recover */ }
      ghostFiringRef.current = false;
    }, 1500);
    return () => {
      clearTimeout(timer);
      ghostFiringRef.current = false;
    };
  }, [decoded, youKey, matchId]);

  const handleArm = async () => {
    await rolet.startSession(60 * 60);
  };

  const handlePlayCard = async () => {
    if (selectedSlot === null || !decoded) return;
    const card = decoded.yourHand[selectedSlot];
    if (!card) return;
    setLog((l) => [`> arming card ${CARD_LABEL[card]}…`, ...l].slice(0, 24));
    await rolet.playCard({
      matchId,
      slot: selectedSlot,
      card,
      currentTurnAuthority: new PublicKey(decoded.currentTurn),
    });
    setSelectedSlot(null);
    // Immediate refetch so the HUD reflects the new state without waiting
    // for the 1.5s poll tick.
    const fresh = await rolet.fetchMatch(matchId);
    if (fresh) setState(fresh);
  };

  const handlePullTrigger = async () => {
    if (!decoded) return;
    setLog((l) => [`> trigger → ${target.toUpperCase()}…`, ...l].slice(0, 24));
    await rolet.pullTrigger({
      matchId,
      targetSelf: target === "self",
      currentTurnAuthority: new PublicKey(decoded.currentTurn),
    });
    const fresh = await rolet.fetchMatch(matchId);
    if (fresh) setState(fresh);
  };

  const opponentStatus: "watching" | "silenced" | "blocking" = useMemo(() => {
    if (!decoded || !youKey) return "watching";
    const oppKey =
      decoded.playerOne === youKey ? decoded.playerTwo : decoded.playerOne;
    if (decoded.silencedYou && decoded.currentTurn === oppKey) return "silenced";
    if (decoded.blockerOnYou) return "blocking";
    return "watching";
  }, [decoded, youKey]);

  const opponentHp = decoded
    ? youKey === decoded.playerOne
      ? decoded.playerTwoHp
      : decoded.playerOneHp
    : 4;
  const playerHp = decoded
    ? youKey === decoded.playerOne
      ? decoded.playerOneHp
      : decoded.playerTwoHp
    : 4;

  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* 3D arena background */}
      <DuelArena3D isYourTurn={turnIsYours} />

      {/* Room atmosphere overlay — kept on top of 3D for CRT feel */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 50% 30%, rgba(80, 35, 15, 0.18) 0%, rgba(10, 6, 4, 0.55) 65%)",
          zIndex: 1,
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(120,70,30,0.4) 0 1px, transparent 1px 140px)",
          zIndex: 1,
        }}
      />

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-6 py-4 border-b border-rust/40 bg-black/40 backdrop-blur-sm">
        <Link href="/" className="text-[10px] tracking-[0.4em] text-rust hover:text-red-500">
          ◄ ABANDON ROOM
        </Link>
        <span className="text-[10px] tracking-[0.4em] text-zinc-600">
          MATCH 0x{matchId.toString(16).toUpperCase()} · ER://magicblock-edge
          {rolet.isEphemeral && <span className="ml-2 text-red-700">· ER ACTIVE</span>}
        </span>
        <span className="text-[10px] tracking-[0.4em] text-red-700 animate-pulse">
          ● {decoded?.status?.toUpperCase() ?? "AWAITING"}
        </span>
      </div>

      <div className="relative z-10 mx-auto grid min-h-screen max-w-7xl grid-rows-[1fr_auto_1fr] gap-4 px-6 pt-16 pb-6">
        {/* OPPONENT */}
        <section className="relative flex flex-col items-center justify-end pt-6">
          <OpponentFigure status={opponentStatus} />
          <OpponentHud hp={opponentHp} maxHp={4} status={opponentStatus} />
        </section>

        {/* TABLE + GUN */}
        <section className="relative flex flex-col items-center">
          <ChamberHud
            chambers={decoded?.chambers ?? Array(8).fill("empty")}
            currentChamber={decoded?.currentChamber ?? 0}
            liveCount={decoded?.liveCount ?? 0}
            blankCount={decoded?.blankCount ?? 0}
          />
          <Table>
            <HandCannon turnIsYours={turnIsYours} target={target} />
          </Table>
        </section>

        {/* PLAYER HUD */}
        <section className="relative flex flex-col gap-4 pt-2">
          <div className="flex justify-center mb-1">
            <PlayerFigure isYourTurn={turnIsYours} />
          </div>
          {decoded?.status === "completed" && !settled && (
            <CompletedBanner
              decoded={decoded}
              youKey={youKey}
              busy={rolet.busy}
              onSettle={async () => {
                const sig = await rolet.settleMatch(matchId);
                if (sig) setSettled(true);
              }}
            />
          )}
          {settled && (
            <div className="border-2 border-rust bg-black/70 px-4 py-3 flex items-center justify-between">
              <div className="text-[11px] tracking-[0.4em] text-rust">
                // MATCH ARCHIVED · REWARD CLAIMED
              </div>
              <Link
                href="/duel"
                className="border border-red-700 bg-red-950/40 px-4 py-2 text-[10px] tracking-[0.3em] text-red-300 hover:bg-red-900/60"
              >
                ► NEW MATCH
              </Link>
            </div>
          )}
          {decoded?.status !== "completed" && !rolet.sessionKey && (
            <div className="border border-red-700 bg-gradient-to-r from-[#1a0606]/80 via-black/60 to-[#1a0606]/80 px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-[9px] tracking-[0.4em] text-red-500">
                  // WEAPON UNARMED
                </div>
                <div className="text-[11px] tracking-[0.2em] text-zinc-400 mt-1">
                  Arm a session key — one signature, then gasless turns.
                </div>
              </div>
              <button
                onClick={handleArm}
                disabled={!wallet.connected || rolet.busy}
                className="border-2 border-red-600 bg-black/60 px-5 py-3 font-display tracking-[0.4em] text-red-400 hover:text-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ▼ ARM WEAPON ▼
              </button>
            </div>
          )}

          <div className="grid grid-cols-12 gap-4">
            <PlayerVitals hp={playerHp} maxHp={4} turnIsYours={turnIsYours} />
            <HandRack
              hand={decoded?.yourHand ?? [null, null, null, null]}
              selectedSlot={selectedSlot}
              onSelect={setSelectedSlot}
              onPlay={handlePlayCard}
              disabled={!turnIsYours || !rolet.sessionKey || !!decoded?.silencedYou || rolet.busy}
            />
            <ActionPanel
              target={target}
              onTargetChange={setTarget}
              onPull={handlePullTrigger}
              disabled={!turnIsYours || !rolet.sessionKey || rolet.busy}
            />
          </div>

          {/* Cursed terminal log — sourced from real toasts + ER deltas */}
          <div className="border border-rust/50 bg-black/70 px-4 py-3 max-h-32 overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="text-[9px] tracking-[0.4em] text-rust">// LOG</div>
              <div className="text-[9px] tracking-[0.4em] text-zinc-700">
                {rolet.sessionKey
                  ? `SK ${rolet.sessionKey.toBase58().slice(0, 6)}…`
                  : "NO SESSION"}
              </div>
            </div>
            <div className="font-mono text-[11px] leading-snug text-zinc-500 space-y-0.5 mt-1">
              {log.slice(0, 5).map((line, i) => (
                <div
                  key={`${i}-${line}`}
                  className={
                    i === 0
                      ? line.startsWith("!!")
                        ? "text-red-500"
                        : line.startsWith(">>")
                        ? "text-red-300"
                        : "text-zinc-300"
                      : ""
                  }
                >
                  {line}
                </div>
              ))}
            </div>
          </div>

          {/* Floating toast stack */}
          {toasts.length > 0 && (
            <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
              {toasts.map((t) => (
                <div
                  key={t.id}
                  className={`border px-4 py-2 bg-black/80 text-[10px] tracking-[0.3em] backdrop-blur-sm ${
                    t.level === "error"
                      ? "border-red-700 text-red-400"
                      : t.level === "success"
                      ? "border-rust text-red-300"
                      : "border-zinc-700 text-zinc-400"
                  }`}
                >
                  {t.level === "error" ? "!! " : t.level === "success" ? ">> " : ".. "}
                  {t.message}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

// ============================================================
// PRESENTATIONAL COMPONENTS — visuals from Task 5, unchanged
// ============================================================
function OpponentFigure({
  status,
}: {
  status: "watching" | "silenced" | "blocking";
}) {
  return (
    <div className="animate-float relative h-44 w-72 sm:h-56 sm:w-96">
      <div
        className="absolute inset-x-0 bottom-0 h-28"
        style={{
          background:
            "linear-gradient(to bottom, transparent, rgba(20,10,6,0.95) 40%, rgba(10,6,4,1) 100%)",
          clipPath:
            "polygon(0 100%, 8% 30%, 22% 12%, 50% 0%, 78% 12%, 92% 30%, 100% 100%)",
        }}
      />
      <div
        className="animate-breathe absolute left-1/2 top-2 -translate-x-1/2"
        style={{ filter: "drop-shadow(0 0 22px rgba(180,30,30,0.5))" }}
      >
        <svg width="120" height="150" viewBox="0 0 120 150" aria-hidden>
          <ellipse cx="60" cy="78" rx="46" ry="62" fill="#d8cabb" opacity="0.92" />
          <ellipse cx="60" cy="78" rx="46" ry="62" fill="url(#porcelain-shadow)" />
          <ellipse cx="42" cy="68" rx="7" ry="11" fill="#0a0807" className="animate-eye-glow" />
          <ellipse cx="78" cy="68" rx="7" ry="11" fill="#0a0807" className="animate-eye-glow" />
          <path d="M 48 110 Q 60 114 72 110" stroke="#1a0e08" strokeWidth="1.5" fill="none" />
          <path d="M 60 16 L 56 50 L 64 90 L 58 130" stroke="#3a2418" strokeWidth="0.8" fill="none" />
          <path d="M 38 40 L 50 60 L 46 88" stroke="#3a2418" strokeWidth="0.6" fill="none" />
          <path d="M 84 38 L 76 70 L 82 100" stroke="#3a2418" strokeWidth="0.6" fill="none" />
          <path d="M 30 90 L 44 96" stroke="#3a2418" strokeWidth="0.5" fill="none" />
          <defs>
            <radialGradient id="porcelain-shadow" cx="50%" cy="60%" r="60%">
              <stop offset="60%" stopColor="transparent" />
              <stop offset="100%" stopColor="rgba(20,10,6,0.85)" />
            </radialGradient>
          </defs>
        </svg>
      </div>
      {status === "silenced" && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] tracking-[0.4em] text-rust">
          // VOICE STILLED
        </span>
      )}
      {status === "blocking" && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] tracking-[0.4em] text-red-500">
          // SHIELD UP
        </span>
      )}
    </div>
  );
}

function PlayerFigure({ isYourTurn }: { isYourTurn: boolean }) {
  return (
    <div className="animate-float-player relative h-28 w-56 sm:h-36 sm:w-72 opacity-70">
      <div
        className="animate-breathe absolute left-1/2 top-0 -translate-x-1/2"
        style={{
          filter: isYourTurn
            ? "drop-shadow(0 0 18px rgba(120,60,20,0.6))"
            : "drop-shadow(0 0 8px rgba(60,20,10,0.3))",
        }}
      >
        {/* Player viewed from behind — darker silhouette */}
        <svg width="90" height="110" viewBox="0 0 90 110" aria-hidden>
          <defs>
            <radialGradient id="player-glow" cx="50%" cy="40%" r="55%">
              <stop offset="0%" stopColor={isYourTurn ? "rgba(120,60,20,0.3)" : "transparent"} />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>
          {/* Body glow */}
          <ellipse cx="45" cy="55" rx="38" ry="50" fill="url(#player-glow)" />
          {/* Head from behind */}
          <ellipse cx="45" cy="28" rx="20" ry="24" fill="#1a0e08" opacity="0.9" />
          {/* Neck */}
          <rect x="39" y="48" width="12" height="10" rx="3" fill="#120908" />
          {/* Shoulders */}
          <path d="M 8 62 Q 20 52 45 55 Q 70 52 82 62 L 78 75 Q 60 68 45 70 Q 30 68 12 75 Z"
            fill="#150a06" opacity="0.95" />
          {/* Spine hint */}
          <line x1="45" y1="50" x2="45" y2="90" stroke="#0a0604" strokeWidth="1.5" opacity="0.6" />
        </svg>
      </div>
    </div>
  );
}

function OpponentHud({
  hp,
  maxHp,
  status,
}: {
  hp: number;
  maxHp: number;
  status: string;
}) {
  return (
    <div className="mt-3 flex items-center gap-4 border border-rust/60 bg-black/60 px-4 py-2">
      <div className="text-[10px] tracking-[0.4em] text-zinc-500">OPPONENT</div>
      <HpStrip hp={hp} maxHp={maxHp} accent="opponent" />
      <div className="text-[10px] tracking-[0.4em] text-rust">
        STATUS · {status.toUpperCase()}
      </div>
    </div>
  );
}

function ChamberHud({
  chambers,
  currentChamber,
  liveCount,
  blankCount,
}: {
  chambers: Chamber[];
  currentChamber: number;
  liveCount: number;
  blankCount: number;
}) {
  return (
    <div className="mb-3 flex flex-col items-center gap-2">
      <div className="flex items-center gap-3 text-[10px] tracking-[0.45em]">
        <span className="text-zinc-600">8 CHAMBERS</span>
        <span className="text-rust">·</span>
        <span className="text-red-500 text-bleed">{liveCount} LIVE</span>
        <span className="text-rust">·</span>
        <span className="text-zinc-400">{blankCount} BLANK</span>
      </div>
      <div className="flex gap-1.5">
        {chambers.map((c, i) => {
          const isCurrent = i === currentChamber;
          const fill =
            c === "empty"
              ? "bg-transparent border-rust/30"
              : c === "live"
              ? "bg-red-900/70 border-red-700 shadow-[0_0_8px_rgba(180,0,0,0.6)]"
              : "bg-zinc-700/50 border-zinc-600";
          return (
            <div
              key={i}
              className={`h-3 w-6 border transition-all ${fill} ${
                isCurrent ? "scale-y-[1.6] -translate-y-0.5" : ""
              }`}
              title={`Chamber ${i + 1}: ${c}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative w-full max-w-3xl h-48 sm:h-56"
      style={{
        background:
          "linear-gradient(to bottom, #2a1810 0%, #180c06 60%, #0a0604 100%)",
        clipPath: "polygon(8% 0%, 92% 0%, 100% 100%, 0% 100%)",
        boxShadow:
          "inset 0 -40px 60px rgba(0,0,0,0.85), inset 0 12px 24px rgba(80,40,15,0.25)",
      }}
    >
      <div
        className="absolute inset-0 opacity-30 mix-blend-overlay"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(70,40,18,0.6) 0 1px, transparent 1px 6px), repeating-linear-gradient(90deg, rgba(40,20,10,0.4) 0 2px, transparent 2px 24px)",
        }}
      />
      <div
        className="absolute inset-x-0 top-0 h-full"
        style={{
          background:
            "radial-gradient(ellipse at 50% 30%, rgba(255,180,120,0.18) 0%, transparent 55%)",
        }}
      />
      <div className="relative h-full flex items-center justify-center">{children}</div>
    </div>
  );
}

function HandCannon({
  turnIsYours,
  target,
}: {
  turnIsYours: boolean;
  target: Target;
}) {
  const rotation = target === "self" ? 90 : -90;
  return (
    <div
      className="relative transition-transform duration-700"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <svg
        width="380"
        height="160"
        viewBox="0 0 380 160"
        aria-hidden
        style={{
          filter:
            "drop-shadow(0 12px 18px rgba(0,0,0,0.85)) drop-shadow(0 0 24px rgba(120,30,10,0.35))",
        }}
      >
        <defs>
          <linearGradient id="rust-metal" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#5a4030" />
            <stop offset="35%" stopColor="#3a2418" />
            <stop offset="70%" stopColor="#1f130a" />
            <stop offset="100%" stopColor="#0a0604" />
          </linearGradient>
          <linearGradient id="rust-spots" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#6b4a30" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#2a1810" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="cylinder-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#4a2f1a" />
            <stop offset="70%" stopColor="#2a1810" />
            <stop offset="100%" stopColor="#0a0604" />
          </radialGradient>
        </defs>

        <rect x="200" y="58" width="160" height="34" fill="url(#rust-metal)" />
        <rect x="200" y="58" width="160" height="34" fill="url(#rust-spots)" opacity="0.6" />
        <rect x="354" y="54" width="14" height="42" fill="#0a0604" />
        <circle cx="361" cy="75" r="6" fill="#000" />
        <circle cx="160" cy="75" r="50" fill="url(#cylinder-grad)" stroke="#1a0e08" strokeWidth="2" />
        <circle cx="160" cy="75" r="50" fill="url(#rust-spots)" opacity="0.5" />
        {Array.from({ length: 8 }).map((_, i) => {
          const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
          const cx = 160 + Math.cos(angle) * 30;
          const cy = 75 + Math.sin(angle) * 30;
          return <circle key={i} cx={cx} cy={cy} r="6" fill="#050302" stroke="#3a2418" />;
        })}
        <circle cx="160" cy="75" r="6" fill="#1a0e08" stroke="#4a2f1a" />
        <rect x="100" y="60" width="40" height="40" fill="url(#rust-metal)" />
        <path d="M 95 58 L 110 48 L 122 60 Z" fill="#2a1810" stroke="#1a0e08" />
        <path
          d="M 100 96 L 86 150 L 50 150 L 78 96 Z"
          fill="#1a0e08"
          stroke="#0a0604"
          strokeWidth="2"
        />
        <path
          d="M 88 105 L 70 145 M 92 110 L 76 145 M 96 115 L 82 145"
          stroke="#3a2418"
          strokeWidth="1"
          fill="none"
          opacity="0.7"
        />
        <path
          d="M 110 100 Q 120 116 110 124 Q 102 116 110 100"
          fill="#2a1810"
          stroke="#0a0604"
        />
        {turnIsYours && (
          <circle
            cx="160"
            cy="75"
            r="55"
            fill="none"
            stroke="rgba(220,40,30,0.4)"
            strokeWidth="2"
          >
            <animate attributeName="r" values="55;62;55" dur="2.4s" repeatCount="indefinite" />
            <animate
              attributeName="stroke-opacity"
              values="0.4;0.15;0.4"
              dur="2.4s"
              repeatCount="indefinite"
            />
          </circle>
        )}
      </svg>
    </div>
  );
}

function PlayerVitals({
  hp,
  maxHp,
  turnIsYours,
}: {
  hp: number;
  maxHp: number;
  turnIsYours: boolean;
}) {
  return (
    <div className="col-span-3 border border-rust/60 bg-black/70 p-3">
      <div className="flex items-center justify-between text-[9px] tracking-[0.4em] text-rust">
        <span>// SUBJECT_01 (YOU)</span>
        <span className={turnIsYours ? "text-red-500 animate-pulse" : "text-zinc-700"}>
          {turnIsYours ? "TURN" : "WAIT"}
        </span>
      </div>
      <div className="mt-3">
        <HpStrip hp={hp} maxHp={maxHp} accent="player" />
      </div>
      <div className="mt-2 text-[10px] tracking-[0.3em] text-zinc-500">
        HP {hp}/{maxHp}
      </div>
    </div>
  );
}

function HpStrip({
  hp,
  maxHp,
  accent,
}: {
  hp: number;
  maxHp: number;
  accent: "player" | "opponent";
}) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: maxHp }).map((_, i) => {
        const alive = i < hp;
        return (
          <div
            key={i}
            className={`h-3 w-8 border ${
              alive
                ? accent === "player"
                  ? "bg-red-700/80 border-red-500 shadow-[0_0_10px_rgba(220,30,30,0.6)]"
                  : "bg-red-900/60 border-red-700"
                : "bg-zinc-900 border-zinc-800"
            }`}
          />
        );
      })}
    </div>
  );
}

function HandRack({
  hand,
  selectedSlot,
  onSelect,
  onPlay,
  disabled,
}: {
  hand: (RoletCard | null)[];
  selectedSlot: number | null;
  onSelect: (i: number | null) => void;
  onPlay: () => void;
  disabled: boolean;
}) {
  return (
    <div className="col-span-6 border border-rust/60 bg-black/70 p-3">
      <div className="flex items-center justify-between text-[9px] tracking-[0.4em] text-rust mb-3">
        <span>// HAND · 4 SLOTS</span>
        {selectedSlot !== null && hand[selectedSlot] && (
          <button
            onClick={onPlay}
            disabled={disabled}
            className="border border-red-700 bg-red-950/40 px-3 py-1 text-[10px] tracking-[0.3em] text-red-300 hover:bg-red-900/60 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ▶ PLAY {CARD_LABEL[hand[selectedSlot]!].toUpperCase()}
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-3">
        {hand.map((card, i) => (
          <CardSlot
            key={i}
            card={card}
            selected={selectedSlot === i}
            onClick={() =>
              card && !disabled
                ? onSelect(selectedSlot === i ? null : i)
                : null
            }
          />
        ))}
      </div>
    </div>
  );
}

function CardSlot({
  card,
  selected,
  onClick,
}: {
  card: RoletCard | null;
  selected: boolean;
  onClick: () => void;
}) {
  if (!card) {
    return (
      <div
        className="aspect-[3/4] border border-dashed border-rust/40 bg-black/40 flex items-center justify-center"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(70,40,18,0.05) 0 6px, transparent 6px 12px)",
        }}
      >
        <span className="text-[9px] tracking-[0.4em] text-rust/60">EMPTY</span>
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`group relative aspect-[3/4] border bg-gradient-to-br from-[#1a0e08] via-[#0e0604] to-[#1a0e08] p-2 text-left transition-all ${
        selected
          ? "border-red-600 shadow-[0_0_24px_rgba(220,30,30,0.6)] -translate-y-1"
          : "border-rust/70 hover:border-red-800 hover:-translate-y-0.5"
      }`}
    >
      <div className="flex items-start justify-between">
        <span className={`text-2xl ${selected ? "text-red-400" : "text-rust"}`}>
          {CARD_GLYPH[card]}
        </span>
        <span className="text-[8px] tracking-[0.3em] text-rust/70">
          {selected ? "ARMED" : "READY"}
        </span>
      </div>
      <div className="mt-auto absolute bottom-2 left-2 right-2">
        <div className={`text-[10px] tracking-[0.2em] uppercase ${selected ? "text-red-300" : "text-zinc-400"}`}>
          {CARD_LABEL[card]}
        </div>
        <div className="mt-1 text-[8px] leading-tight text-zinc-600">
          {CARD_BLURB[card]}
        </div>
      </div>
      {selected && (
        <div className="pointer-events-none absolute inset-0 border border-red-500/50 animate-pulse" />
      )}
    </button>
  );
}

function ActionPanel({
  target,
  onTargetChange,
  onPull,
  disabled,
}: {
  target: Target;
  onTargetChange: (t: Target) => void;
  onPull: () => void;
  disabled: boolean;
}) {
  return (
    <div className="col-span-3 border border-rust/60 bg-black/70 p-3 flex flex-col gap-3">
      <div className="text-[9px] tracking-[0.4em] text-rust">// FIRING SOLUTION</div>

      <div className="grid grid-cols-2 gap-2">
        <TargetButton
          label="OPPONENT"
          active={target === "opponent"}
          onClick={() => onTargetChange("opponent")}
        />
        <TargetButton
          label="SELF"
          active={target === "self"}
          onClick={() => onTargetChange("self")}
        />
      </div>

      <button
        onClick={onPull}
        disabled={disabled}
        className={`relative mt-auto py-4 border-2 font-display tracking-[0.4em] text-lg transition-all ${
          disabled
            ? "border-rust/40 text-rust/40 cursor-not-allowed"
            : "border-red-600 bg-gradient-to-b from-red-950/60 to-black text-red-400 text-bleed animate-blood hover:text-red-200"
        }`}
      >
        ▼ PULL TRIGGER ▼
        <div className="mt-1 text-[8px] tracking-[0.5em] text-rust">
          target → {target.toUpperCase()}
        </div>
      </button>
    </div>
  );
}

function CompletedBanner({
  decoded,
  youKey,
  busy,
  onSettle,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  decoded: any;
  youKey: string | null;
  busy: boolean;
  onSettle: () => Promise<unknown>;
}) {
  const youWon =
    youKey && decoded.winner && decoded.winner.toString
      ? decoded.winner.toString() === youKey
      : decoded.playerOneHp > 0
      ? decoded.playerOne === youKey
      : decoded.playerTwo === youKey;

  return (
    <div
      className={`border-2 px-4 py-4 flex items-center justify-between ${
        youWon
          ? "border-red-500 bg-gradient-to-r from-[#1a0606] via-[#3a0606]/80 to-[#1a0606] animate-blood"
          : "border-rust bg-black/70"
      }`}
    >
      <div>
        <div
          className={`text-[10px] tracking-[0.5em] ${
            youWon ? "text-red-400 text-bleed" : "text-rust"
          }`}
        >
          // MATCH RESOLVED
        </div>
        <div
          className={`mt-1 font-display tracking-[0.4em] text-2xl ${
            youWon ? "text-red-400 text-bleed" : "text-zinc-500"
          }`}
        >
          {youWon ? "YOU WIN" : "GHOST WINS"}
        </div>
        <div className="mt-1 text-[10px] tracking-[0.3em] text-zinc-600">
          {youWon
            ? "claim your reward · 1 $ROLET will be transferred"
            : "match closed · no reward · NFT durability decremented"}
        </div>
      </div>
      <button
        onClick={onSettle}
        disabled={busy}
        className={`border-2 px-6 py-3 font-display tracking-[0.4em] text-sm ${
          youWon
            ? "border-red-600 bg-black/60 text-red-400 hover:text-red-200"
            : "border-rust bg-black/40 text-rust hover:text-zinc-400"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {busy ? "SETTLING…" : youWon ? "▼ CLAIM REWARD ▼" : "▼ ACKNOWLEDGE ▼"}
      </button>
    </div>
  );
}

function TargetButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`py-2 border text-[10px] tracking-[0.3em] transition-all ${
        active
          ? "border-red-600 bg-red-950/60 text-red-300 shadow-[0_0_12px_rgba(220,30,30,0.5)]"
          : "border-rust/60 bg-black/40 text-zinc-500 hover:border-rust hover:text-zinc-300"
      }`}
    >
      {active ? "▣" : "□"} {label}
    </button>
  );
}

// ============================================================
// Shared lobby background + nav bar
// ============================================================
function LobbyShell({
  subtitle,
  statusTag,
  children,
  toasts,
}: {
  subtitle: string;
  statusTag: string;
  children: React.ReactNode;
  toasts: ReturnType<typeof useToasts>;
}) {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse at 50% 30%, rgba(80, 35, 15, 0.35) 0%, rgba(10, 6, 4, 1) 65%), #050302",
        }}
      />
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-6 py-4 border-b border-rust/40 bg-black/40 backdrop-blur-sm">
        <Link href="/" className="text-[10px] tracking-[0.4em] text-rust hover:text-red-500">
          ◄ BACK
        </Link>
        <span className="text-[10px] tracking-[0.4em] text-zinc-600">{subtitle}</span>
        <span className="text-[10px] tracking-[0.4em] text-rust">{statusTag}</span>
      </div>
      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-24 text-center">
        {children}
      </div>
      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`border px-4 py-2 bg-black/80 text-[10px] tracking-[0.3em] backdrop-blur-sm ${
                t.level === "error"
                  ? "border-red-700 text-red-400"
                  : t.level === "success"
                  ? "border-rust text-red-300"
                  : "border-zinc-700 text-zinc-400"
              }`}
            >
              {t.level === "error" ? "!! " : t.level === "success" ? ">> " : ".. "}
              {t.message}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

// ============================================================
// LOBBY — create-match CTA (opens a LobbyState PDA, share link)
// ============================================================
function Lobby() {
  const router = useRouter();
  const wallet = useWallet();
  const rolet = useRolet({ ephemeral: false });
  const toasts = useToasts();
  const [busy, setBusy] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [profile, setProfile] = useState<any | null | undefined>(undefined);
  useEffect(() => {
    if (!rolet.program || !wallet.publicKey) { setProfile(undefined); return; }
    let alive = true;
    (async () => { const p = await rolet.fetchProfile(); if (alive) setProfile(p); })();
    return () => { alive = false; };
  }, [rolet, wallet.publicKey]);

  const handleCreate = useCallback(async () => {
    if (!wallet.publicKey || !profile) { router.push("/profile"); return; }
    setBusy(true);
    try {
      const openMatchId = await rolet.findOpenLobby();
      if (openMatchId) {
        router.replace(`/duel?join=${openMatchId.toString(16)}&auto=true`);
        return;
      }

      const idBytes = new Uint8Array(8);
      crypto.getRandomValues(idBytes);
      const matchId = new BN(idBytes);
      const matchHex = matchId.toString(16);

      const { secret, commit } = rolet.generateCommitReveal();
      // Stash in the same key that initMatch's recallSecret reads
      window.sessionStorage.setItem(
        `rolet:secret:${matchId.toString()}`,
        Buffer.from(secret).toString("hex")
      );

      const sig = await rolet.openLobby(matchId, commit);
      if (sig) router.replace(`/duel?lobby=${matchHex}`);
    } finally {
      setBusy(false);
    }
  }, [router, rolet, wallet.publicKey, profile]);

  return (
    <LobbyShell subtitle="MATCHMAKING · GLOBAL SERVER" statusTag="// IDLE" toasts={toasts}>
      <span className="text-[10px] tracking-[0.6em] text-zinc-600 mb-4">
        // CHAMBER UNLOADED — NO ACTIVE PROTOCOL
      </span>

      <h1 className="font-display text-bleed leading-none select-none" style={{ fontSize: "clamp(3rem, 9vw, 7rem)" }}>
        MATCHMAKING
      </h1>

      <p className="mt-4 max-w-xl text-sm tracking-[0.2em] text-zinc-500 uppercase">
        Scanning the Solana network for an opponent. If no open lobbies are found, you will host a new one and wait for a challenger.
      </p>

      <div className="mt-3 flex items-center gap-3 text-[10px] tracking-[0.4em] text-rust">
        <span className="h-px w-12 bg-rust" />
        GLOBAL POOL · ON-CHAIN
        <span className="h-px w-12 bg-rust" />
      </div>

      <div className="mt-12 flex flex-col items-center gap-3">
        {wallet.connected && profile === null ? (
          <Link
            href="/profile"
            className="border-2 border-rust bg-gradient-to-b from-[#1a0e08] to-black px-10 py-5 font-display tracking-[0.4em] text-xl text-rust hover:text-red-400 hover:border-red-700 transition-all"
          >
            ▼ SETUP PROFILE FIRST ▼
            <div className="mt-1 text-[8px] tracking-[0.5em] text-zinc-700">
              no PlayerProfile PDA found · settle_match would fail
            </div>
          </Link>
        ) : (
          <button
            onClick={handleCreate}
            disabled={!wallet.connected || busy || rolet.busy || !rolet.program || profile === undefined}
            className="border-2 border-red-600 bg-gradient-to-b from-red-950/60 to-black px-10 py-5 font-display tracking-[0.4em] text-xl text-red-400 text-bleed animate-blood transition-all hover:text-red-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:animate-none"
          >
            {busy || rolet.busy ? "▼ SCANNING NETWORK…" : "▼ FIND MATCH ▼"}
            <div className="mt-1 text-[8px] tracking-[0.5em] text-rust">
              {wallet.connected
                ? profile === undefined ? "checking profile…" : "auto connects or hosts"
                : "wallet not connected"}
            </div>
          </button>
        )}

        {!wallet.connected && (
          <span className="text-[10px] tracking-[0.4em] text-rust mt-2">
            // CONNECT A WALLET FROM THE NAV BAR
          </span>
        )}
      </div>
    </LobbyShell>
  );
}

// ============================================================
// HOST WAITING — polls lobby, shows shareable link, launches match
// ============================================================
function HostWaiting({ matchId }: { matchId: BN }) {
  const router = useRouter();
  const wallet = useWallet();
  const rolet = useRolet({ ephemeral: false });
  const toasts = useToasts();
  const matchHex = matchId.toString(16);
  const [lobby, setLobby] = useState<any>(null);  // eslint-disable-line @typescript-eslint/no-explicit-any
  const [launching, setLaunching] = useState(false);
  const joinUrl = typeof window !== "undefined"
    ? `${window.location.origin}/duel?join=${matchHex}`
    : `/duel?join=${matchHex}`;

  // Poll lobby every 1.5s for guest.
  // Also checks every 4s for OTHER open lobbies (race-condition fix: both
  // players opened lobbies simultaneously — whoever finds the other first
  // auto-navigates to join instead of waiting forever).
  useEffect(() => {
    if (!rolet.program || !wallet.publicKey) return;
    let alive = true;
    const poll = setInterval(async () => {
      if (!alive) return;
      try {
        const l = await rolet.fetchLobby(matchId);
        if (alive) setLobby(l);
      } catch { /* swallow */ }
    }, 1500);

    const crossCheck = setInterval(async () => {
      if (!alive) return;
      try {
        const otherId = await rolet.findOpenLobby(wallet.publicKey!);
        if (alive && otherId) {
          router.replace(`/duel?join=${otherId.toString(16)}&auto=true`);
        }
      } catch { /* swallow */ }
    }, 4000);

    rolet.fetchLobby(matchId).then((l) => { if (alive) setLobby(l); });
    return () => { alive = false; clearInterval(poll); clearInterval(crossCheck); };
  }, [rolet, matchId, wallet.publicKey, router]);

  const guestReady = !!lobby?.guest;

  const handleLaunch = useCallback(async () => {
    if (!wallet.publicKey || !lobby) return;
    setLaunching(true);
    try {
      const guestPk = lobby.guest as PublicKey;
      // initMatch reads host secret via recallSecret(matchId.toString()),
      // which was stashed by Lobby when open_lobby was called.
      const sig = await rolet.initMatch({
        matchId,
        opponent: guestPk,
        opponentCommit: Uint8Array.from(lobby.guestCommit),
        opponentSecret: Uint8Array.from(lobby.guestSecret),
      });
      if (sig) {
        await rolet.delegateMatch(matchId);
        await rolet.closeLobby(matchId);
        router.replace(`/duel?match=${matchHex}`);
      }
    } finally {
      setLaunching(false);
    }
  }, [wallet.publicKey, lobby, matchHex, matchId, rolet, router]);

  return (
    <LobbyShell subtitle={`LOBBY · 0x${matchHex.toUpperCase()}`} statusTag={guestReady ? "// CHALLENGER FOUND" : "// WAITING"} toasts={toasts}>
      <span className="text-[10px] tracking-[0.6em] text-zinc-600 mb-4">
        // LOBBY HOSTED ON-CHAIN
      </span>

      <h1 className="font-display text-bleed leading-none select-none" style={{ fontSize: "clamp(2rem, 7vw, 5rem)" }}>
        {guestReady ? "MATCH READY" : "SCANNING…"}
      </h1>

      <div className="mt-8 w-full max-w-xl border border-rust/60 bg-black/70 p-4 text-left">
        <div className="text-[9px] tracking-[0.4em] text-rust mb-2">// LOBBY STATUS</div>
        <div className="flex items-center gap-3">
          <code className="flex-1 text-[11px] text-zinc-300">
            {guestReady ? "An opponent has matched with your lobby." : "Waiting for another player to click 'Find Match'..."}
          </code>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-4">
        <div className={`h-2 w-2 rounded-full ${guestReady ? "bg-red-500 shadow-[0_0_8px_rgba(220,30,30,0.8)]" : "bg-zinc-700"} animate-pulse`} />
        <span className="text-[10px] tracking-[0.4em] text-zinc-500">
          {guestReady
            ? `OPPONENT JOINED · ${(lobby.guest as PublicKey).toBase58().slice(0, 8)}…`
            : "waiting for opponent wallet…"}
        </span>
      </div>

      <button
        onClick={handleLaunch}
        disabled={!guestReady || launching || rolet.busy}
        className="mt-8 border-2 border-red-600 bg-gradient-to-b from-red-950/60 to-black px-10 py-5 font-display tracking-[0.4em] text-xl text-red-400 text-bleed animate-blood transition-all hover:text-red-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:animate-none"
      >
        {launching || rolet.busy ? "▼ LAUNCHING…" : "▼ LAUNCH MATCH ▼"}
        <div className="mt-1 text-[8px] tracking-[0.5em] text-rust">
          {guestReady ? "signs init_match · seals both commits" : "disabled until opponent joins"}
        </div>
      </button>
    </LobbyShell>
  );
}

// ============================================================
// GUEST LOBBY — joins lobby, then polls for match to appear
// ============================================================
function GuestLobby({ matchId, autoJoin = false }: { matchId: BN, autoJoin?: boolean }) {
  const router = useRouter();
  const wallet = useWallet();
  const rolet = useRolet({ ephemeral: false });
  const toasts = useToasts();
  const matchHex = matchId.toString(16);
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autoTriggered, setAutoTriggered] = useState(false);

  const handleJoin = useCallback(async () => {
    if (!wallet.publicKey) return;
    setBusy(true);
    try {
      const { secret, commit } = rolet.generateCommitReveal();
      const sig = await rolet.joinLobby(matchId, commit, secret);
      if (sig) setJoined(true);
    } finally {
      setBusy(false);
    }
  }, [wallet.publicKey, rolet, matchId]);

  useEffect(() => {
    if (autoJoin && wallet.publicKey && rolet.program && !joined && !busy && !autoTriggered) {
      setAutoTriggered(true);
      handleJoin();
    }
  }, [autoJoin, wallet.publicKey, rolet.program, joined, busy, autoTriggered, handleJoin]);

  // After joining, poll for MatchState to appear (host calls init_match)
  useEffect(() => {
    if (!joined || !rolet.program) return;
    let alive = true;
    const poll = setInterval(async () => {
      try {
        const m = await rolet.fetchMatch(matchId);
        if (alive && m) {
          clearInterval(poll);
          router.replace(`/duel?match=${matchHex}`);
        }
      } catch { /* swallow RPC errors between polls */ }
    }, 1500);
    return () => { alive = false; clearInterval(poll); };
  }, [joined, rolet, matchId, matchHex, router]);

  return (
    <LobbyShell subtitle={`MATCH · 0x${matchHex.toUpperCase()}`} statusTag={joined ? "// JOINED" : "// STANDBY"} toasts={toasts}>
      <span className="text-[10px] tracking-[0.6em] text-zinc-600 mb-4">
        // OPPONENT FOUND
      </span>

      <h1 className="font-display text-bleed leading-none select-none" style={{ fontSize: "clamp(2rem, 7vw, 5rem)" }}>
        {joined ? "WAITING FOR HOST…" : "CONNECTING"}
      </h1>

      <p className="mt-4 max-w-xl text-sm tracking-[0.2em] text-zinc-500 uppercase">
        {joined
          ? "Your commit is on-chain. Waiting for the host to launch the match…"
          : "Sign the transaction to join the opponent's lobby."}
      </p>

      {!joined && (
        <button
          onClick={handleJoin}
          disabled={!wallet.connected || busy || rolet.busy}
          className="mt-12 border-2 border-red-600 bg-gradient-to-b from-red-950/60 to-black px-10 py-5 font-display tracking-[0.4em] text-xl text-red-400 text-bleed animate-blood transition-all hover:text-red-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:animate-none"
        >
          {busy || rolet.busy ? "▼ JOINING…" : "▼ JOIN LOBBY ▼"}
          <div className="mt-1 text-[8px] tracking-[0.5em] text-rust">
            {wallet.connected ? "signs join_lobby tx" : "connect wallet first"}
          </div>
        </button>
      )}

      {joined && (
        <div className="mt-12 flex items-center gap-4">
          <div className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(220,30,30,0.8)] animate-pulse" />
          <span className="text-[10px] tracking-[0.4em] text-zinc-500">
            polling for match · host must click launch match…
          </span>
        </div>
      )}

      {!wallet.connected && (
        <span className="text-[10px] tracking-[0.4em] text-rust mt-8">
          // CONNECT A WALLET FROM THE NAV BAR
        </span>
      )}
    </LobbyShell>
  );
}
