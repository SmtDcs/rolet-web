"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Nav, Footer } from "@/components/Nav";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import idl from "@/idl/rolet.json";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LeaderboardEntry = {
  rank: number;
  authority: string;
  snsDomain: string;
  wins: number;
  losses: number;
  matchesPlayed: number;
  eloRating: number;
  totalRewardsClaimed: number;
};

const READONLY_WALLET = {
  publicKey: PublicKey.default,
  signTransaction: async (tx: unknown) => tx,
  signAllTransactions: async (txs: unknown[]) => txs,
};

export default function LeaderboardPage() {
  const { connection } = useConnection();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const provider = new AnchorProvider(
          connection,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          READONLY_WALLET as any,
          { commitment: "confirmed" }
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const program = new Program(idl as any, provider);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const accounts: any[] = await (program.account as any).playerProfile.all();

        const sorted: LeaderboardEntry[] = accounts
          .map((a, i) => ({
            rank: i + 1,
            authority: a.account.authority.toBase58(),
            snsDomain: a.account.snsDomain || "",
            wins: a.account.stats.wins,
            losses: a.account.stats.losses,
            matchesPlayed: a.account.stats.matchesPlayed,
            eloRating: a.account.stats.eloRating,
            totalRewardsClaimed: Number(a.account.stats.totalRewardsClaimed),
          }))
          .sort((a, b) => b.eloRating - a.eloRating)
          .map((e, i) => ({ ...e, rank: i + 1 }));

        if (alive) {
          setEntries(sorted);
          setLoading(false);
        }
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();
    return () => { alive = false; };
  }, [connection]);

  return (
    <main className="relative min-h-screen overflow-hidden">
      <Nav />
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse at 50% 20%, rgba(80, 20, 20, 0.4) 0%, rgba(10, 6, 4, 1) 65%), #050302",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-4xl flex-col items-center px-4 py-28">
        <span className="text-[10px] tracking-[0.6em] text-zinc-600 mb-4">
          // PROTOCOL_ID 0x0C — KILL REGISTRY
        </span>

        <h1
          className="font-display text-bleed leading-none select-none text-center"
          style={{ fontSize: "clamp(3rem, 9vw, 5.5rem)" }}
        >
          LEADERBOARD
        </h1>

        <div className="mt-3 flex items-center gap-3 text-[10px] tracking-[0.4em] text-rust">
          <span className="h-px w-12 bg-rust" />
          SORTED BY ELO · LIVE FROM CHAIN
          <span className="h-px w-12 bg-rust" />
        </div>

        <div className="mt-10 w-full">
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={error} />
          ) : entries.length === 0 ? (
            <EmptyState />
          ) : (
            <Table entries={entries} />
          )}
        </div>

        <div className="mt-8 text-[9px] tracking-[0.4em] text-zinc-700 text-center">
          // DATA PULLED VIA getProgramAccounts · PUBLIC DEVNET RPC
        </div>
      </div>
      <Footer />
    </main>
  );
}

function LoadingState() {
  return (
    <div className="border border-rust/40 bg-black/70 px-8 py-12 text-center animate-blood">
      <div className="text-[11px] tracking-[0.5em] text-rust">
        ▼ TUNING SIGNAL…
      </div>
      <div className="mt-2 text-[9px] tracking-[0.3em] text-zinc-600">
        fetching on-chain kill registry
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="border border-red-900/60 bg-black/70 px-8 py-10 text-center">
      <div className="text-[11px] tracking-[0.4em] text-red-500 text-bleed mb-2">
        !! SIGNAL LOST
      </div>
      <div className="text-[9px] tracking-[0.3em] text-zinc-600 max-w-sm mx-auto break-all">
        {message}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border border-rust/40 bg-black/70 px-8 py-12 text-center">
      <div className="text-[11px] tracking-[0.5em] text-rust mb-2">
        NO KILLS RECORDED
      </div>
      <div className="text-[9px] tracking-[0.3em] text-zinc-600">
        be the first to pull the trigger
      </div>
      <Link
        href="/duel"
        className="mt-6 inline-block border border-red-700 bg-red-950/40 px-6 py-3 text-[10px] tracking-[0.3em] text-red-300 hover:bg-red-900/60"
      >
        ► ENTER LOBBY
      </Link>
    </div>
  );
}

function Table({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="w-full border border-rust/40 bg-black/70 overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[2rem_1fr_4rem_4rem_4rem_5rem] gap-2 px-4 py-3 border-b border-rust/40 bg-black/60">
        {["#", "PLAYER", "W", "L", "ELO", "$ROLET"].map((h) => (
          <span key={h} className="text-[9px] tracking-[0.4em] text-rust">
            {h}
          </span>
        ))}
      </div>

      {/* Rows */}
      {entries.map((e) => (
        <div
          key={e.authority}
          className={`grid grid-cols-[2rem_1fr_4rem_4rem_4rem_5rem] gap-2 px-4 py-3 border-b border-rust/20 last:border-b-0 hover:bg-red-950/10 transition-colors ${
            e.rank === 1 ? "bg-red-950/20" : ""
          }`}
        >
          <span
            className={`text-[11px] tracking-[0.2em] font-display ${
              e.rank === 1
                ? "text-red-400 text-bleed"
                : e.rank === 2
                ? "text-zinc-400"
                : e.rank === 3
                ? "text-amber-900"
                : "text-zinc-600"
            }`}
          >
            {e.rank === 1 ? "①" : e.rank === 2 ? "②" : e.rank === 3 ? "③" : `${e.rank}`}
          </span>

          <span className="text-[11px] tracking-[0.15em] text-zinc-300 truncate font-display">
            {e.snsDomain
              ? e.snsDomain
              : `${e.authority.slice(0, 4)}…${e.authority.slice(-4)}`}
          </span>

          <span className="text-[11px] tracking-[0.2em] text-red-400">
            {e.wins}
          </span>

          <span className="text-[11px] tracking-[0.2em] text-zinc-600">
            {e.losses}
          </span>

          <span
            className={`text-[11px] tracking-[0.2em] ${
              e.eloRating >= 1200
                ? "text-red-400"
                : e.eloRating >= 1000
                ? "text-zinc-300"
                : "text-zinc-600"
            }`}
          >
            {e.eloRating}
          </span>

          <span className="text-[11px] tracking-[0.15em] text-zinc-500">
            {(e.totalRewardsClaimed / 1e6).toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
}
