// app/profile/page.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useRolet, useToasts } from "@/hooks/useRolet";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProfileSnapshot = any;

export default function ProfilePage() {
  const wallet = useWallet();
  const rolet = useRolet({ ephemeral: false });
  const toasts = useToasts();
  const router = useRouter();

  const [snsDomain, setSnsDomain] = useState("");
  const [profile, setProfile] = useState<ProfileSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Pull existing profile on mount / wallet change.
  useEffect(() => {
    if (!rolet.program || !wallet.publicKey) {
      setProfile(null);
      return;
    }
    let alive = true;
    (async () => {
      const p = await rolet.fetchProfile();
      if (alive) setProfile(p);
    })();
    return () => {
      alive = false;
    };
  }, [rolet, wallet.publicKey, refreshKey]);

  const handleCreate = useCallback(async () => {
    if (!wallet.publicKey || !snsDomain) return;
    setLoading(true);
    try {
      // Fire the tx — sig may come back null if the RPC client times out on
      // confirmation even though the tx actually lands, so don't gate the
      // redirect on it.
      await rolet.initProfile({ snsDomain, durabilityMax: 10 });

      // Poll for the on-chain PlayerProfile PDA to appear, then redirect.
      // Up to ~8s, every 400ms.
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 400));
        const fresh = await rolet.fetchProfile();
        if (fresh) {
          setProfile(fresh);
          setRefreshKey((k) => k + 1);
          router.replace("/duel");
          return;
        }
      }
      // If we got here, the profile never showed up — surface a hint.
      // eslint-disable-next-line no-console
      console.warn("[rolet] profile not found after 8s — check tx logs");
    } finally {
      setLoading(false);
    }
  }, [rolet, snsDomain, wallet.publicKey, router]);

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
        <Link
          href="/"
          className="text-[10px] tracking-[0.4em] text-rust hover:text-red-500"
        >
          ◄ HOME
        </Link>
        <span className="text-[10px] tracking-[0.4em] text-zinc-600">
          IDENTITY · PLAYER_PROFILE PDA
        </span>
        <span className="text-[10px] tracking-[0.4em] text-rust">
          {profile ? "// REGISTERED" : "// ANONYMOUS"}
        </span>
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-24 text-center">
        <span className="text-[10px] tracking-[0.6em] text-zinc-600 mb-4">
          // PROTOCOL_ID 0x08 — IDENTITY MODULE
        </span>

        <h1
          className="font-display text-bleed leading-none select-none"
          style={{ fontSize: "clamp(3rem, 9vw, 6rem)" }}
        >
          {profile ? "PROFILE" : "ENROLL"}
        </h1>

        <div className="mt-3 flex items-center gap-3 text-[10px] tracking-[0.4em] text-rust">
          <span className="h-px w-12 bg-rust" />
          {profile ? "ON-CHAIN IDENTITY ACTIVE" : "NO PROFILE FOUND"}
          <span className="h-px w-12 bg-rust" />
        </div>

        {!wallet.connected ? (
          <div className="mt-12 border border-rust/60 bg-black/70 px-8 py-6">
            <span className="text-[11px] tracking-[0.4em] text-rust">
              // CONNECT A WALLET FROM THE NAV BAR
            </span>
          </div>
        ) : profile ? (
          <ExistingProfileCard profile={profile} />
        ) : (
          <SetupForm
            snsDomain={snsDomain}
            onChange={setSnsDomain}
            onSubmit={handleCreate}
            loading={loading || rolet.busy}
            disabled={!rolet.program}
          />
        )}

        {/* Toast stack */}
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
      </div>
    </main>
  );
}

function SetupForm({
  snsDomain,
  onChange,
  onSubmit,
  loading,
  disabled,
}: {
  snsDomain: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  disabled: boolean;
}) {
  return (
    <div className="mt-12 w-full max-w-md border border-red-900 bg-black/70 p-6 text-left animate-blood">
      <div className="text-[9px] tracking-[0.4em] text-red-500 text-bleed mb-4">
        // SETUP IDENTITY
      </div>

      <label className="block text-[10px] tracking-[0.3em] text-rust mb-1">
        SNS HANDLE (max 32 chars)
      </label>
      <input
        type="text"
        value={snsDomain}
        onChange={(e) => onChange(e.target.value.slice(0, 32))}
        maxLength={32}
        placeholder="arda.sol"
        className="w-full bg-black border border-rust/60 px-3 py-2 text-zinc-200 tracking-[0.2em] text-sm focus:outline-none focus:border-red-600"
      />
      <div className="mt-1 text-[9px] tracking-[0.3em] text-zinc-700">
        {snsDomain.length}/32
      </div>

      <div className="mt-4 text-[10px] tracking-[0.3em] text-rust space-y-1">
        <div>character_nft → System Program (placeholder)</div>
        <div>durability_max → 10 matches</div>
        <div>elo → 1000 (starting)</div>
      </div>

      <button
        onClick={onSubmit}
        disabled={loading || disabled || snsDomain.length === 0}
        className="mt-6 w-full border-2 border-red-600 bg-gradient-to-b from-red-950/60 to-black px-6 py-4 font-display tracking-[0.4em] text-red-400 text-bleed hover:text-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? "▼ ENROLLING…" : "▼ ENROLL ▼"}
      </button>

      <div className="mt-3 text-[9px] tracking-[0.4em] text-rust text-center">
        cost ≈ 0.002 SOL · paid by you
      </div>
    </div>
  );
}

function ExistingProfileCard({ profile }: { profile: ProfileSnapshot }) {
  const stats = profile.stats;
  return (
    <div className="mt-12 w-full max-w-md border border-rust bg-black/70 p-6 text-left">
      <div className="text-[9px] tracking-[0.4em] text-red-500 text-bleed mb-4">
        // CARD ON FILE
      </div>

      <Row label="SNS" value={profile.snsDomain || "(none)"} />
      <Row
        label="DURABILITY"
        value={`${profile.durabilityRemaining}/${profile.durabilityMax}`}
      />
      <Row label="MATCHES" value={String(stats.matchesPlayed)} />
      <Row label="WINS / LOSSES" value={`${stats.wins} / ${stats.losses}`} />
      <Row label="ELO" value={String(stats.eloRating)} />
      <Row
        label="EARNED"
        value={`${(Number(stats.totalRewardsClaimed) / 1e6).toFixed(2)} $ROLET`}
      />

      <Link
        href="/duel"
        className="mt-6 block text-center border border-red-700 bg-red-950/40 py-3 text-[11px] tracking-[0.3em] text-red-300 hover:bg-red-900/60"
      >
        ► ENTER LOBBY
      </Link>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-rust/30 py-2 text-[11px] tracking-[0.2em]">
      <span className="text-rust">{label}</span>
      <span className="text-zinc-300">{value}</span>
    </div>
  );
}
