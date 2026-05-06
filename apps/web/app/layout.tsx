import type { Metadata } from "next";
import { Special_Elite, VT323 } from "next/font/google";
import { SolanaProvider } from "@/components/SolanaProvider";
import "./globals.css";

const display = Special_Elite({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-rolet-display",
});

const mono = VT323({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-rolet-mono",
});

export const metadata: Metadata = {
  title: "ROLET // The Last Round",
  description: "A cursed Russian Roulette protocol on Solana.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="relative min-h-screen bg-[#0a0807] text-zinc-200 antialiased overflow-x-hidden selection:bg-red-900 selection:text-zinc-100">
        {/* Inline SVG turbulence — film-grain noise source */}
        <svg className="hidden" aria-hidden>
          <filter id="rolet-noise">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </svg>

        <SolanaProvider>{children}</SolanaProvider>

        {/* ───── Cursed-monitor overlay stack ───── */}
        <div
          className="pointer-events-none fixed inset-0 z-[80] opacity-[0.18] mix-blend-overlay animate-noise"
          style={{ filter: "url(#rolet-noise)" }}
        />
        <div
          className="pointer-events-none fixed inset-0 z-[81] opacity-30"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(0,0,0,0.55) 0px, rgba(0,0,0,0.55) 1px, transparent 2px, transparent 3px)",
          }}
        />
        <div
          className="pointer-events-none fixed inset-0 z-[82] mix-blend-screen opacity-40"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 55%, rgba(120,0,0,0.35) 100%)",
          }}
        />
        <div className="pointer-events-none fixed inset-0 z-[83] animate-flicker bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.85)_100%)]" />
      </body>
    </html>
  );
}
