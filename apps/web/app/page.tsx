"use client";

import Link from "next/link";
import { Nav, Footer } from "@/components/Nav";

// ── Hero section ──────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center text-center px-6 overflow-hidden crt-frame crt-grain">
      {/* Scanlines layer */}
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,200,180,0.5) 0 1px, transparent 1px 3px)",
        }}
      />
      {/* Radial ambient */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 40%, rgba(120,30,10,0.22) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center">
        <span className="text-[10px] tracking-[0.6em] text-zinc-600 mb-6 crt-text">
          // SIGNAL FOUND — PROTOCOL_ID 0x08
        </span>

        <h1
          className="font-display text-bleed animate-title leading-none select-none"
          style={{ fontSize: "clamp(5rem, 14vw, 12rem)" }}
        >
          ROLET
        </h1>

        <p className="mt-4 text-[11px] tracking-[0.35em] text-zinc-400 crt-text uppercase">
          // ON-CHAIN RUSSIAN ROULETTE · PROVABLY FAIR · SOLANA
        </p>

        <div className="mt-3 flex items-center gap-3 text-[10px] tracking-[0.4em] text-rust">
          <span className="h-px w-12 bg-rust" />
          EIGHT CHAMBERS · THREE BLANKS · ONE WALKS OUT
          <span className="h-px w-12 bg-rust" />
        </div>

        <div className="mt-10 flex flex-col sm:flex-row gap-4 items-center">
          <Link
            href="/duel"
            className="border-2 border-red-600 bg-gradient-to-b from-red-950/60 to-black px-10 py-4 font-display tracking-[0.4em] text-lg text-red-400 text-bleed animate-blood hover:text-red-200 transition-all"
          >
            ▶ ENTER ARENA
          </Link>
          <Link
            href="/profile"
            className="border-2 border-rust bg-black/70 px-10 py-4 font-display tracking-[0.4em] text-lg text-rust hover:text-zinc-300 hover:border-zinc-500 transition-all"
          >
            ▒ CREATE PROFILE
          </Link>
        </div>

        <div className="mt-8 text-[9px] tracking-[0.5em] text-zinc-700 crt-text">
          MAGICBLOCK · ER ACTIVE · DEVNET
        </div>
      </div>

      {/* Bullet ring SVG — procedural, rotating */}
      <div
        className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center opacity-[0.06]"
        aria-hidden
      >
        <svg
          width="900"
          height="900"
          viewBox="0 0 900 900"
          className="animate-float-slow"
          style={{ transform: "rotate(0deg)" }}
        >
          {Array.from({ length: 8 }).map((_, i) => {
            const angle = (i / 8) * Math.PI * 2;
            const cx = 450 + Math.cos(angle) * 340;
            const cy = 450 + Math.sin(angle) * 340;
            return (
              <g key={i} transform={`translate(${cx},${cy})`}>
                <ellipse rx="8" ry="22" fill="#cc2222" />
                <ellipse rx="5" ry="12" fill="#ff4444" opacity="0.5" />
              </g>
            );
          })}
          <circle cx="450" cy="450" r="340" fill="none" stroke="#4a1010" strokeWidth="1" />
          <circle cx="450" cy="450" r="300" fill="none" stroke="#2a0808" strokeWidth="1" />
        </svg>
      </div>
    </section>
  );
}

// ── How It Works ──────────────────────────────────────────────────────────────
const HOW_STEPS = [
  {
    num: "01",
    title: "CONNECT",
    blurb: "Link your Solana wallet and register a .sol identity via SNS.",
    icon: "⬡",
  },
  {
    num: "02",
    title: "STAKE",
    blurb: "Deposit $ROLET into the on-chain vault. Winner takes all.",
    icon: "◈",
  },
  {
    num: "03",
    title: "SURVIVE",
    blurb: "12 tactical cards. 8 chambers. One round decides everything.",
    icon: "◎",
  },
];

function HowItWorks() {
  return (
    <section className="py-24 px-6">
      <div className="mx-auto max-w-5xl">
        <div className="text-center mb-14">
          <div className="text-[10px] tracking-[0.6em] text-zinc-600 mb-2 crt-text">
            // HOW_IT_WORKS
          </div>
          <h2 className="font-display text-bleed text-4xl md:text-5xl tracking-widest">
            THREE STEPS
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {HOW_STEPS.map((s) => (
            <div
              key={s.num}
              className="crt-frame crt-grain border border-rust/60 bg-black/70 p-8 text-center"
            >
              <div
                className="font-display text-6xl text-red-900/70 animate-float leading-none select-none"
                style={{ textShadow: "0 0 30px rgba(180,0,0,0.3)" }}
              >
                {s.num}
              </div>
              <div className="mt-4 text-2xl text-rust">{s.icon}</div>
              <div className="mt-2 font-display tracking-[0.4em] text-xl text-red-400 crt-text">
                {s.title}
              </div>
              <p className="mt-3 text-[11px] tracking-[0.2em] text-zinc-500 uppercase leading-relaxed">
                {s.blurb}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Features grid ─────────────────────────────────────────────────────────────
const FEATURES = [
  {
    title: "ON-CHAIN RANDOMNESS",
    blurb: "Anchor + slot hashes. No off-chain oracle. Results are deterministic and verifiable on-chain.",
    tag: "PROVABLY FAIR",
  },
  {
    title: "SESSION KEYS",
    blurb: "Gasless turns via ephemeral session keys. One wallet popup to start — zero during the match.",
    tag: "1 SIGNATURE",
  },
  {
    title: "SNS IDENTITY",
    blurb: "Your .sol domain appears in the arena. On-chain identity, no usernames database.",
    tag: "BONFIDA · SNS",
  },
  {
    title: "TACTICAL CARDS",
    blurb: "12 unique cards × 8 chambers. Buckshot-style strategy layer on top of raw luck.",
    tag: "12 × 8",
  },
];

function Features() {
  return (
    <section className="py-24 px-6 border-t border-rust/20">
      <div className="mx-auto max-w-5xl">
        <div className="text-center mb-14">
          <div className="text-[10px] tracking-[0.6em] text-zinc-600 mb-2 crt-text">
            // PROTOCOL_FEATURES
          </div>
          <h2 className="font-display text-bleed text-4xl md:text-5xl tracking-widest">
            WHAT MAKES IT TICK
          </h2>
        </div>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="crt-frame crt-grain border border-rust/50 bg-black/70 p-6"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="font-display tracking-[0.35em] text-lg text-red-400 crt-text">
                  {f.title}
                </div>
                <span className="text-[9px] tracking-[0.3em] border border-rust/60 px-2 py-0.5 text-rust crt-text shrink-0 ml-2">
                  {f.tag}
                </span>
              </div>
              <p className="text-[11px] tracking-[0.2em] text-zinc-500 uppercase leading-relaxed">
                {f.blurb}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Tech strip ────────────────────────────────────────────────────────────────
const TECH_BADGES = [
  "SOLANA",
  "ANCHOR 0.30",
  "NEXT 16",
  "R3F",
  "DEVNET",
  "COLOSSEUM 2026",
];

function TechStrip() {
  return (
    <section className="border-t border-rust/20 border-b border-rust/20 py-5 px-6 overflow-x-auto">
      <div className="flex items-center justify-center gap-6 min-w-max mx-auto">
        {TECH_BADGES.map((b, i) => (
          <span
            key={b}
            className="text-[10px] tracking-[0.4em] text-zinc-600 crt-text"
          >
            {b}
            {i < TECH_BADGES.length - 1 && (
              <span className="ml-6 text-rust">·</span>
            )}
          </span>
        ))}
      </div>
    </section>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────
export default function Page() {
  return (
    <main className="relative min-h-screen">
      <Nav />
      <div className="pt-12">
        <Hero />
        <HowItWorks />
        <Features />
        <TechStrip />
        <Footer />
      </div>
    </main>
  );
}
