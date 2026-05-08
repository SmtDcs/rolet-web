"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

// WalletMultiButton touches `window` — must be client-only.
const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

const NAV_ITEMS = ["HOME", "COLLECTION", "PROFILE", "SETTINGS"] as const;

function shortAddress(addr: string) {
  if (addr.length <= 9) return addr;
  return `${addr.slice(0, 5)}...${addr.slice(-4)}`;
}

function Navbar() {
  const { publicKey, connected } = useWallet();
  const formatted = useMemo(
    () => (publicKey ? shortAddress(publicKey.toBase58()) : null),
    [publicKey]
  );

  return (
    <header className="fixed top-0 inset-x-0 z-40 border-b border-rust/60 backdrop-blur-sm bg-black/40">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="font-display text-xl tracking-[0.3em] text-red-700 text-bleed"
          >
            ROLET<span className="text-zinc-500">/</span>
          </Link>
          <nav className="hidden md:flex gap-6">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item}
                href={`/${item.toLowerCase()}`}
                className="text-xs tracking-[0.25em] text-zinc-500 hover:text-red-500 hover:text-bleed transition-colors"
              >
                {item}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          {connected && formatted && (
            <div className="hidden sm:flex items-center gap-2 border border-rust/70 bg-black/60 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-red-600 animate-pulse" />
              <span className="text-xs tracking-[0.2em] text-zinc-300">
                {formatted}
              </span>
            </div>
          )}
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}

function GameModeCard({
  title,
  subtitle,
  locked,
  href,
}: {
  title: string;
  subtitle: string;
  locked?: boolean;
  href?: string;
}) {
  if (locked) {
    return (
      <div
        aria-disabled
        className="group relative cursor-not-allowed border border-rust bg-[#120a06]/80 p-8 transition-all"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, rgba(80,40,10,0.06) 0 8px, transparent 8px 16px)",
        }}
      >
        <div className="absolute -top-3 left-4 bg-[#0a0807] px-2 text-[10px] tracking-[0.4em] text-rust">
          // SEALED
        </div>
        <h3 className="font-display text-3xl tracking-widest text-rust">{title}</h3>
        <p className="mt-2 text-xs tracking-[0.2em] text-zinc-700 uppercase">
          {subtitle}
        </p>
        <div className="mt-6 inline-flex items-center gap-2 border border-rust/60 px-3 py-1 text-[10px] tracking-[0.3em] text-rust">
          <span className="inline-block h-2 w-2 bg-rust" /> LOCKED
        </div>
        <div
          className="pointer-events-none absolute inset-0 opacity-40 mix-blend-multiply"
          style={{
            backgroundImage:
              "radial-gradient(circle at 30% 80%, rgba(60,30,10,0.6), transparent 60%)",
          }}
        />
      </div>
    );
  }

  return (
    <Link
      href={href ?? "#"}
      className="group relative block border border-red-900 bg-gradient-to-br from-[#1a0606] via-[#0a0202] to-[#1a0606] p-8 animate-blood transition-transform hover:scale-[1.02]"
    >
      <div className="absolute -top-3 left-4 bg-[#0a0807] px-2 text-[10px] tracking-[0.4em] text-red-500 text-bleed">
        // LIVE PROTOCOL
      </div>
      <h3 className="font-display text-4xl tracking-widest text-red-500 text-bleed">
        {title}
      </h3>
      <p className="mt-2 text-xs tracking-[0.2em] text-red-300/70 uppercase">
        {subtitle}
      </p>
      <div className="mt-6 inline-flex items-center gap-3 border border-red-700 bg-black/70 px-4 py-2 text-xs tracking-[0.3em] text-red-400 group-hover:bg-red-950/60 group-hover:text-red-200 transition-colors">
        <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        ENTER THE ROOM
      </div>
    </Link>
  );
}

export default function Page() {
  return (
    <main className="relative min-h-screen">
      <Navbar />

      <section className="relative pt-40 pb-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="relative flex flex-col items-center text-center">
            <span className="text-[10px] tracking-[0.6em] text-zinc-600 mb-4">
              // SIGNAL FOUND — PROTOCOL_ID 0x08
            </span>

            <h1
              className="font-display text-bleed animate-title leading-none select-none"
              style={{ fontSize: "clamp(5rem, 16vw, 14rem)" }}
            >
              ROLET
            </h1>

            <p className="mt-4 max-w-2xl text-sm tracking-[0.25em] text-zinc-500 uppercase">
              Eight chambers. Three blanks. One of you walks out.
            </p>

            <div className="mt-3 flex items-center gap-3 text-[10px] tracking-[0.4em] text-rust">
              <span className="h-px w-12 bg-rust" />
              ON-CHAIN. NON-CONSENSUAL. FINAL.
              <span className="h-px w-12 bg-rust" />
            </div>
          </div>

          <div className="mt-20 grid gap-6 md:grid-cols-3">
            <GameModeCard
              title="UNRANKED"
              subtitle="Casual chambers · disabled"
              locked
            />
            <GameModeCard
              title="DUEL"
              subtitle="Web3 · winner takes the vault"
              href="/duel"
            />
            <GameModeCard
              title="RANKED"
              subtitle="Season-locked · disabled"
              locked
            />
          </div>

          <div className="mt-16 flex items-center justify-between border-t border-rust/40 pt-4 text-[10px] tracking-[0.4em] text-zinc-700">
            <span>BUILD 0.1.0-CURSED</span>
            <span className="animate-pulse text-red-700">● SIGNAL UNSTABLE</span>
            <span>MAGICBLOCK · ER ONLINE</span>
          </div>
        </div>
      </section>
    </main>
  );
}
