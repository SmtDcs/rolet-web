"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

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
      <div className="flex gap-6 items-center">
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
      <WalletMultiButton />
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-rust/30 px-6 py-3 text-[9px] tracking-[0.4em] text-zinc-600 flex justify-between crt-text">
      <span>// COLOSSEUM FRONTIER · 2026</span>
      <span>github.com/SmtDcs/rolet-web</span>
    </footer>
  );
}
