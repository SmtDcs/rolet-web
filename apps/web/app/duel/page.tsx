// app/duel/page.tsx
"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
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
// ── Damage number type ───────────────────────────────────────────────────────
type DamageNum = { id: number; value: number; x: number };
let dmgSeq = 0;

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

  // ── Animation state ────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const [hitFlash, setHitFlash] = useState<"player" | "opponent" | null>(null);
  const [damageNums, setDamageNums] = useState<DamageNum[]>([]);
  const [showTurnBanner, setShowTurnBanner] = useState(false);
  const prevPlayerHpRef = useRef<number | null>(null);
  const prevOpponentHpRef = useRef<number | null>(null);
  const prevTurnRef = useRef<boolean | null>(null);

  // ── Gun state ──────────────────────────────────────────────────────────────
  const [gunHeld, setGunHeld] = useState(false);
  const [firing, setFiring] = useState(false);

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
    triggerShake();
    setFiring(true);
    setTimeout(() => setFiring(false), 650);
    await rolet.pullTrigger({
      matchId,
      targetSelf: target === "self",
      currentTurnAuthority: new PublicKey(decoded.currentTurn),
    });
    const fresh = await rolet.fetchMatch(matchId);
    if (fresh) setState(fresh);
  };

  // ── Screen shake ──────────────────────────────────────────────────────────
  const triggerShake = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.classList.remove("animate-shake");
    void el.offsetWidth; // reflow
    el.classList.add("animate-shake");
    setTimeout(() => el.classList.remove("animate-shake"), 450);
  }, []);

  // ── Detect HP changes → hit flash + damage numbers ────────────────────────
  const opponentHp = decoded
    ? youKey === decoded.playerOne ? decoded.playerTwoHp : decoded.playerOneHp
    : 4;
  const playerHp = decoded
    ? youKey === decoded.playerOne ? decoded.playerOneHp : decoded.playerTwoHp
    : 4;

  useEffect(() => {
    if (playerHp === null) return;
    if (prevPlayerHpRef.current !== null && playerHp < prevPlayerHpRef.current) {
      const diff = prevPlayerHpRef.current - playerHp;
      setHitFlash("player");
      setDamageNums((prev) => [...prev, { id: ++dmgSeq, value: -diff, x: 48 }]);
      triggerShake();
      setTimeout(() => setHitFlash(null), 550);
    }
    prevPlayerHpRef.current = playerHp;
  }, [playerHp, triggerShake]);

  useEffect(() => {
    if (opponentHp === null) return;
    if (prevOpponentHpRef.current !== null && opponentHp < prevOpponentHpRef.current) {
      const diff = prevOpponentHpRef.current - opponentHp;
      setDamageNums((prev) => [...prev, { id: ++dmgSeq, value: -diff, x: 52 }]);
    }
    prevOpponentHpRef.current = opponentHp;
  }, [opponentHp]);

  // ── Turn change banner + auto-pickup gun on your turn ─────────────────────
  useEffect(() => {
    if (prevTurnRef.current === null) { prevTurnRef.current = turnIsYours; return; }
    if (prevTurnRef.current === turnIsYours) return;
    prevTurnRef.current = turnIsYours;
    setShowTurnBanner(true);
    setTimeout(() => setShowTurnBanner(false), 2200);
    // Pick up the gun automatically when it becomes your turn,
    // put it back on the table when it doesn't.
    setGunHeld(turnIsYours);
  }, [turnIsYours]);

  const opponentStatus: "watching" | "silenced" | "blocking" = useMemo(() => {
    if (!decoded || !youKey) return "watching";
    const oppKey =
      decoded.playerOne === youKey ? decoded.playerTwo : decoded.playerOne;
    if (decoded.silencedYou && decoded.currentTurn === oppKey) return "silenced";
    if (decoded.blockerOnYou) return "blocking";
    return "watching";
  }, [decoded, youKey]);

  return (
    <main
      ref={containerRef}
      className="fixed inset-0 overflow-hidden"
      style={{ width: "100vw", height: "100vh" }}
    >
      {/* 3D arena background — covers entire viewport, behind everything */}
      <DuelArena3D
        isYourTurn={turnIsYours}
        gunHeld={gunHeld}
        setGunHeld={setGunHeld}
        target={target}
        firing={firing}
      />

      {/* Hit flash overlay */}
      <AnimatePresence>
        {hitFlash === "player" && (
          <motion.div
            key="hit-flash"
            className="pointer-events-none fixed inset-0 z-[100]"
            initial={{ opacity: 0.65 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
            style={{ background: "radial-gradient(ellipse at 50% 90%, rgba(255,0,0,0.55) 0%, rgba(140,0,0,0.35) 40%, transparent 70%)" }}
          />
        )}
      </AnimatePresence>

      {/* Turn banner */}
      <AnimatePresence>
        {showTurnBanner && (
          <motion.div
            key={turnIsYours ? "your-turn" : "enemy-turn"}
            className="pointer-events-none fixed inset-x-0 top-1/3 z-[90] flex flex-col items-center"
            initial={{ opacity: 0, y: -32, scaleX: 1.1 }}
            animate={{ opacity: 1, y: 0, scaleX: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.95 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className={`px-12 py-4 border-2 backdrop-blur-sm ${
              turnIsYours
                ? "border-red-500 bg-black/70"
                : "border-zinc-600 bg-black/60"
            }`}>
              <div className={`font-display tracking-[0.5em] text-4xl ${
                turnIsYours ? "text-red-400 text-bleed" : "text-zinc-400"
              }`}>
                {turnIsYours ? "YOUR TURN" : "ENEMY TURN"}
              </div>
              <div className={`mt-1 text-center text-[9px] tracking-[0.6em] ${
                turnIsYours ? "text-rust" : "text-zinc-600"
              }`}>
                {turnIsYours ? "// WEAPON ARMED — CHOOSE ACTION" : "// OPPONENT IS DECIDING"}
              </div>
            </div>
            {/* Scan line effect across banner */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
              <div className="w-full h-px bg-white animate-scan-line" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating damage numbers */}
      <AnimatePresence>
        {damageNums.map((d) => (
          <motion.div
            key={d.id}
            className="pointer-events-none fixed z-[95] font-display font-bold select-none"
            style={{ left: `${d.x}%`, top: "45%", color: d.value < 0 ? "#ff3333" : "#33ff88" }}
            initial={{ opacity: 1, y: 0, scale: 1.4 }}
            animate={{ opacity: 0, y: -90, scale: 0.8 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.6, ease: "easeOut" }}
            onAnimationComplete={() =>
              setDamageNums((prev) => prev.filter((x) => x.id !== d.id))
            }
          >
            <span className="text-5xl" style={{ textShadow: "0 0 20px currentColor, 0 0 40px currentColor" }}>
              {d.value < 0 ? d.value : `+${d.value}`}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Room atmosphere overlay — subtle tint above 3D, below UI */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 50% 30%, transparent 0%, rgba(10, 6, 4, 0.4) 75%)",
          zIndex: 2,
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(120,70,30,0.4) 0 1px, transparent 1px 140px)",
          zIndex: 2,
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

      <div className="relative z-10 mx-auto grid h-full max-w-7xl grid-rows-[auto_1fr_auto] gap-3 px-6 pt-16 pb-4 overflow-hidden">
        {/* OPPONENT HUD ONLY (HP bar + status) — 3D shows through behind */}
        <section className="relative flex justify-center pt-2">
          <OpponentHud hp={opponentHp} maxHp={4} status={opponentStatus} />
        </section>

        {/* CCTV VIEWPORT — 3D scene shows through this framed window */}
        <section className="relative flex items-stretch justify-center">
          <CCTVViewport
            chambers={decoded?.chambers ?? Array(8).fill("empty")}
            currentChamber={decoded?.currentChamber ?? 0}
            liveCount={decoded?.liveCount ?? 0}
            blankCount={decoded?.blankCount ?? 0}
            turnIsYours={turnIsYours}
            matchHex={matchId.toString(16)}
          />
        </section>

        {/* PLAYER HUD */}
        <section className="relative flex flex-col gap-4 pt-2">
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
          {decoded?.status !== "completed" && !rolet.sessionKey && rolet.busy && (
            <div className="border border-rust/40 bg-black/60 px-4 py-3 flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-red-600 animate-pulse" />
              <span className="text-[10px] tracking-[0.3em] text-zinc-500">
                // ARMING SESSION KEY…
              </span>
            </div>
          )}

          <div className="grid grid-cols-12 gap-4">
            <PlayerVitals hp={playerHp} maxHp={4} turnIsYours={turnIsYours} />
            <HandRack
              hand={decoded?.yourHand ?? [null, null, null, null]}
              selectedSlot={selectedSlot}
              onSelect={setSelectedSlot}
              onPlay={handlePlayCard}
              disabled={!turnIsYours || !!decoded?.silencedYou || rolet.busy}
            />
            <ActionPanel
              target={target}
              onTargetChange={setTarget}
              onPull={handlePullTrigger}
              disabled={!turnIsYours || rolet.busy}
            />
          </div>

          {/* Cursed terminal log — sourced from real toasts + ER deltas */}
          <div className="border border-rust/50 bg-black/70 backdrop-blur-sm px-4 py-3 max-h-32 overflow-hidden">
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
// ── CCTV-style viewport — 3D scene shows through this frame ──────────────────
function CCTVViewport({
  chambers,
  currentChamber,
  liveCount,
  blankCount,
  turnIsYours,
  matchHex,
}: {
  chambers: Chamber[];
  currentChamber: number;
  liveCount: number;
  blankCount: number;
  turnIsYours: boolean;
  matchHex: string;
}) {
  const [time, setTime] = useState("");
  useEffect(() => {
    const update = () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      setTime(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="pointer-events-none relative w-full max-w-5xl">
      {/* CCTV frame — transparent interior so 3D shows through.
          pointer-events-none on the outer wrapper so clicks pass to the
          Canvas behind (gun is interactive). */}
      <div
        className="relative aspect-[16/8] border-2 border-rust/70 bg-transparent"
        style={{
          boxShadow:
            "inset 0 0 40px rgba(120,30,10,0.35), 0 0 24px rgba(60,10,5,0.6)",
        }}
      >
        {/* Corner brackets (CCTV monitor style) */}
        <div className="pointer-events-none absolute top-1 left-1 h-6 w-6 border-t-2 border-l-2 border-red-500" />
        <div className="pointer-events-none absolute top-1 right-1 h-6 w-6 border-t-2 border-r-2 border-red-500" />
        <div className="pointer-events-none absolute bottom-1 left-1 h-6 w-6 border-b-2 border-l-2 border-red-500" />
        <div className="pointer-events-none absolute bottom-1 right-1 h-6 w-6 border-b-2 border-r-2 border-red-500" />

        {/* Scanline overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08] mix-blend-screen"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(255,200,180,0.4) 0 1px, transparent 1px 3px)",
          }}
        />

        {/* CCTV chrome — top row */}
        <div className="absolute top-2 left-3 right-3 flex items-center justify-between text-[9px] tracking-[0.4em] font-mono">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_6px_rgba(255,0,0,0.9)]" />
            <span className="text-red-500">● REC</span>
            <span className="text-rust/70">CAM_01</span>
            <span className="text-zinc-700">·</span>
            <span className="text-rust/70">ARENA-MAIN</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-zinc-600">0x{matchHex.slice(0, 6).toUpperCase()}</span>
            <span className="text-rust/70">{time}</span>
          </div>
        </div>

        {/* Chamber indicator row — overlay at top-center of viewport */}
        <div className="absolute top-9 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-3 text-[9px] tracking-[0.45em]">
            <span className="text-zinc-500">8 CHAMBERS</span>
            <span className="text-rust">·</span>
            <span className="text-red-500 text-bleed">{liveCount} LIVE</span>
            <span className="text-rust">·</span>
            <span className="text-zinc-400">{blankCount} BLANK</span>
          </div>
          <div className="flex gap-1.5 items-center">
            {chambers.map((c, i) => {
              const isCurrent = i === currentChamber;
              return (
                <motion.div
                  key={i}
                  animate={isCurrent ? {
                    scaleY: [1.6, 1.9, 1.6],
                    boxShadow: ["0 0 8px rgba(220,30,30,0.8)", "0 0 22px rgba(255,40,40,1)", "0 0 8px rgba(220,30,30,0.8)"],
                  } : { scaleY: 1, boxShadow: "none" }}
                  transition={isCurrent ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
                  className={`h-3 w-6 border ${
                    c === "empty"
                      ? "bg-transparent border-rust/30"
                      : c === "live"
                      ? "bg-red-900/70 border-red-700"
                      : "bg-zinc-700/50 border-zinc-600"
                  } ${isCurrent ? "-translate-y-0.5" : ""}`}
                />
              );
            })}
          </div>
        </div>

        {/* Bottom-status strip */}
        <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between text-[9px] tracking-[0.4em] font-mono">
          <span className="text-rust/80">
            {turnIsYours ? "▶ FIRING SOLUTION ARMED" : "◌ AWAITING OPPONENT"}
          </span>
          <span className="text-zinc-600">
            FEED · 1280x720 · 30FPS · DEVNET
          </span>
        </div>

        {/* Crosshair when it's your turn */}
        {turnIsYours && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <motion.div
              className="relative h-16 w-16"
              animate={{ opacity: [0.4, 0.85, 0.4] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            >
              <div className="absolute inset-0 border border-red-500/70 rounded-full" />
              <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-red-500/50" />
              <div className="absolute top-1/2 left-0 w-full h-px -translate-y-1/2 bg-red-500/50" />
            </motion.div>
          </div>
        )}
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
    <div className="mt-3 flex items-center gap-4 border border-rust/60 bg-black/70 backdrop-blur-sm px-4 py-2">
      <div className="text-[10px] tracking-[0.4em] text-zinc-500">OPPONENT</div>
      <HpBar hp={hp} maxHp={maxHp} accent="opponent" />
      <div className="text-[10px] tracking-[0.4em] text-rust">
        STATUS · {status.toUpperCase()}
      </div>
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
    <div className="col-span-3 border border-rust/60 bg-black/70 backdrop-blur-sm p-3">
      <div className="flex items-center justify-between text-[9px] tracking-[0.4em] text-rust">
        <span>// SUBJECT_01 (YOU)</span>
        <span className={turnIsYours ? "text-red-500 animate-pulse" : "text-zinc-700"}>
          {turnIsYours ? "TURN" : "WAIT"}
        </span>
      </div>
      <div className="mt-3">
        <HpBar hp={hp} maxHp={maxHp} accent="player" />
      </div>
      <div className="mt-2 text-[10px] tracking-[0.3em] text-zinc-500">
        HP {hp}/{maxHp}
      </div>
    </div>
  );
}

function HpBar({
  hp,
  maxHp,
  accent,
}: {
  hp: number;
  maxHp: number;
  accent: "player" | "opponent";
}) {
  const pct = (hp / maxHp) * 100;
  const low = hp <= 1;
  const mid = hp === 2;
  const barColor = low
    ? "#dc2020"
    : mid
    ? "#cc5500"
    : accent === "player"
    ? "#991a1a"
    : "#7a1212";

  return (
    <div className="w-full">
      {/* Segmented pips */}
      <div className="flex gap-1 mb-2">
        {Array.from({ length: maxHp }).map((_, i) => {
          const alive = i < hp;
          return (
            <motion.div
              key={i}
              layout
              animate={alive ? {
                backgroundColor: low ? "#ff2020" : mid ? "#dd6600" : barColor,
                boxShadow: alive && low
                  ? ["0 0 8px #ff2020aa", "0 0 22px #ff2020", "0 0 8px #ff2020aa"]
                  : alive
                  ? `0 0 10px ${barColor}88`
                  : "none",
              } : {
                backgroundColor: "#111",
                boxShadow: "none",
              }}
              transition={low && alive ? {
                boxShadow: { duration: 0.9, repeat: Infinity, ease: "easeInOut" },
                backgroundColor: { duration: 0.2 },
              } : { duration: 0.3 }}
              className="h-5 flex-1 border border-zinc-800"
            />
          );
        })}
      </div>
      {/* Progress bar */}
      <div className="h-1.5 w-full bg-zinc-900 overflow-hidden">
        <motion.div
          className="h-full"
          animate={{ width: `${pct}%`, backgroundColor: barColor }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          style={{ boxShadow: `0 0 8px ${barColor}` }}
        />
      </div>
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
    <div className="col-span-6 border border-rust/60 bg-black/70 backdrop-blur-sm p-3">
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
        style={{ backgroundImage: "repeating-linear-gradient(45deg, rgba(70,40,18,0.05) 0 6px, transparent 6px 12px)" }}
      >
        <span className="text-[9px] tracking-[0.4em] text-rust/60">EMPTY</span>
      </div>
    );
  }

  return (
    <motion.button
      onClick={onClick}
      animate={selected ? {
        y: -10,
        boxShadow: ["0 0 20px rgba(220,30,30,0.5)", "0 0 36px rgba(220,30,30,0.85)", "0 0 20px rgba(220,30,30,0.5)"],
      } : { y: 0, boxShadow: "none" }}
      whileHover={{ y: selected ? -12 : -4, transition: { duration: 0.15 } }}
      transition={selected ? { boxShadow: { duration: 1.4, repeat: Infinity, ease: "easeInOut" }, y: { duration: 0.2 } } : { duration: 0.2 }}
      className={`group relative aspect-[3/4] border bg-gradient-to-br from-[#1a0e08] via-[#0e0604] to-[#1a0e08] p-2 text-left ${
        selected ? "border-red-600" : "border-rust/70 hover:border-red-800"
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
        <div className="pointer-events-none absolute inset-0 border border-red-500/30" />
      )}
    </motion.button>
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
    <div className="col-span-3 border border-rust/60 bg-black/70 backdrop-blur-sm p-3 flex flex-col gap-3">
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

      <motion.button
        onClick={onPull}
        disabled={disabled}
        animate={!disabled ? {
          boxShadow: [
            "0 0 12px rgba(220,30,30,0.4), inset 0 0 16px rgba(120,0,0,0.3)",
            "0 0 36px rgba(255,30,30,0.85), inset 0 0 28px rgba(180,0,0,0.55)",
            "0 0 12px rgba(220,30,30,0.4), inset 0 0 16px rgba(120,0,0,0.3)",
          ],
        } : { boxShadow: "none" }}
        whileHover={!disabled ? { scale: 1.02, transition: { duration: 0.12 } } : {}}
        whileTap={!disabled ? { scale: 0.97 } : {}}
        transition={!disabled ? { boxShadow: { duration: 2.0, repeat: Infinity, ease: "easeInOut" } } : {}}
        className={`relative mt-auto py-4 border-2 font-display tracking-[0.4em] text-lg transition-colors ${
          disabled
            ? "border-rust/40 text-rust/40 cursor-not-allowed"
            : "border-red-600 bg-gradient-to-b from-red-950/60 to-black text-red-400 text-bleed hover:text-red-200"
        }`}
      >
        ▼ PULL TRIGGER ▼
        <div className="mt-1 text-[8px] tracking-[0.5em] text-rust">
          target → {target.toUpperCase()}
        </div>
      </motion.button>
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
      // Scan for an existing open lobby (exclude own lobbies to prevent self-match)
      const openLobby = await rolet.findOpenLobby(wallet.publicKey);
      if (openLobby) {
        router.replace(`/duel?join=${openLobby.matchId.toString(16)}&auto=true`);
        return;
      }

      // No open lobby found — host a new one.
      // Use Date.now() so the matchId is a timestamp; findOpenLobby filters
      // out lobbies older than 5 minutes by comparing matchId to Date.now()-5min.
      const matchId = new BN(Date.now().toString());
      const matchHex = matchId.toString(16);

      const { secret, commit } = rolet.generateCommitReveal();
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

  // Auto-arm session key while waiting for opponent — one popup now means
  // zero popups during the match itself.
  const autoArmedRef = useRef(false);
  useEffect(() => {
    if (!wallet.publicKey || !rolet.program || rolet.sessionKey || autoArmedRef.current) return;
    autoArmedRef.current = true;
    rolet.startSession(60 * 60).catch(() => { autoArmedRef.current = false; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!wallet.publicKey, !!rolet.program, !!rolet.sessionKey]);

  // useRolet returns a NEW object reference every render (busy is useState).
  // Putting `rolet` in the effect's dep array means the poll fires setLobby
  // every 2s → re-render → rolet is new → effect cleanup → 6s timer resets.
  // The cross-check can NEVER fire. Fix: access rolet via a ref.
  const roletRef = useRef(rolet);
  roletRef.current = rolet;

  // !!rolet.program flips once (false → true) when the wallet connects,
  // which is the only time we actually need to (re-)start the timers.
  const programReady = !!rolet.program;

  useEffect(() => {
    if (!programReady || !wallet.publicKey) return;
    let alive = true;

    const poll = setInterval(async () => {
      if (!alive) return;
      try {
        const l = await roletRef.current.fetchLobby(matchId);
        if (alive) setLobby(l);
      } catch { /* swallow */ }
    }, 2000);

    let crossCheckInterval: ReturnType<typeof setInterval> | null = null;

    // Cross-check fires 6s after mount, then every 5s.
    // If two players both opened lobbies, the one with the larger pubkey
    // (deterministic) abandons its lobby and joins the other's.
    const crossCheckTimer = setTimeout(() => {
      crossCheckInterval = setInterval(async () => {
        if (!alive) return;
        try {
          const myLobby = await roletRef.current.fetchLobby(matchId);
          if (myLobby?.guest) return; // Guest already arrived — stay as host

          const other = await roletRef.current.findOpenLobby(wallet.publicKey!);
          if (!alive || !other) return;

          if (wallet.publicKey!.toBase58() > other.host.toBase58()) {
            router.replace(`/duel?join=${other.matchId.toString(16)}&auto=true`);
          }
        } catch { /* swallow */ }
      }, 5000);
    }, 6000);

    roletRef.current.fetchLobby(matchId).then((l) => { if (alive) setLobby(l); });
    return () => {
      alive = false;
      clearInterval(poll);
      clearTimeout(crossCheckTimer);
      if (crossCheckInterval) clearInterval(crossCheckInterval);
    };
    // rolet intentionally excluded — accessed via roletRef to prevent the
    // 6s cross-check timer from resetting on every 2s lobby poll re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programReady, matchId, wallet.publicKey, router]);

  const guestReady = !!lobby?.guest;
  const autoLaunchedRef = useRef(false);

  const handleLaunch = useCallback(async () => {
    if (!wallet.publicKey || !lobby) return;
    setLaunching(true);
    try {
      const guestPk = lobby.guest as PublicKey;
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

  // Auto-launch as soon as a guest is detected — no button press needed
  useEffect(() => {
    if (guestReady && !autoLaunchedRef.current && !launching && !rolet.busy) {
      autoLaunchedRef.current = true;
      handleLaunch();
    }
  }, [guestReady, launching, rolet.busy, handleLaunch]);

  return (
    <LobbyShell subtitle={`LOBBY · 0x${matchHex.toUpperCase()}`} statusTag={guestReady ? "// CHALLENGER FOUND" : "// WAITING"} toasts={toasts}>
      <span className="text-[10px] tracking-[0.6em] text-zinc-600 mb-4">
        // LOBBY HOSTED ON-CHAIN
      </span>

      <h1 className="font-display text-bleed leading-none select-none" style={{ fontSize: "clamp(2rem, 7vw, 5rem)" }}>
        {launching || rolet.busy ? "LAUNCHING…" : guestReady ? "OPPONENT FOUND" : "SCANNING…"}
      </h1>

      <div className="mt-8 w-full max-w-xl border border-rust/60 bg-black/70 p-4 text-left">
        <div className="text-[9px] tracking-[0.4em] text-rust mb-2">// LOBBY STATUS</div>
        <code className="text-[11px] text-zinc-300">
          {launching || rolet.busy
            ? "Initializing match on-chain…"
            : guestReady
            ? "Opponent joined — launching automatically…"
            : "Scanning for an opponent…"}
        </code>
      </div>

      <div className="mt-6 flex items-center gap-4">
        <div className={`h-2 w-2 rounded-full ${guestReady ? "bg-red-500 shadow-[0_0_8px_rgba(220,30,30,0.8)]" : "bg-zinc-700"} animate-pulse`} />
        <span className="text-[10px] tracking-[0.4em] text-zinc-500">
          {guestReady
            ? `OPPONENT · ${(lobby.guest as PublicKey).toBase58().slice(0, 8)}…`
            : "waiting for opponent…"}
        </span>
      </div>

      {/* Manual fallback in case auto-launch fails */}
      {guestReady && !launching && !rolet.busy && (
        <button
          onClick={handleLaunch}
          className="mt-8 border-2 border-red-600 bg-gradient-to-b from-red-950/60 to-black px-10 py-5 font-display tracking-[0.4em] text-xl text-red-400 text-bleed animate-blood transition-all hover:text-red-200"
        >
          ▼ LAUNCH MATCH ▼
          <div className="mt-1 text-[8px] tracking-[0.5em] text-rust">tap if auto-launch stalled</div>
        </button>
      )}
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
  // useRef is synchronous — prevents double-fire from React batching setState
  const autoTriggeredRef = useRef(false);

  // Auto-arm session key while waiting — one popup now, zero popups in-match.
  const guestArmedRef = useRef(false);
  useEffect(() => {
    if (!wallet.publicKey || !rolet.program || rolet.sessionKey || guestArmedRef.current) return;
    guestArmedRef.current = true;
    rolet.startSession(60 * 60).catch(() => { guestArmedRef.current = false; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!wallet.publicKey, !!rolet.program, !!rolet.sessionKey]);

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
    if (autoJoin && wallet.publicKey && rolet.program && !joined && !busy && !autoTriggeredRef.current) {
      autoTriggeredRef.current = true;
      handleJoin();
    }
  }, [autoJoin, wallet.publicKey, rolet.program, joined, busy, handleJoin]);

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
