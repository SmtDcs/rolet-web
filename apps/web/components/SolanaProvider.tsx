"use client";

import { ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { clusterApiUrl } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";

export function SolanaProvider({ children }: { children: ReactNode }) {
  const network =
    (process.env.NEXT_PUBLIC_SOLANA_NETWORK as WalletAdapterNetwork) ??
    WalletAdapterNetwork.Devnet;

  const endpoint = useMemo(() => {
    const raw = process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? clusterApiUrl(network);
    // Relative paths like "/api/rpc" only work in the browser.
    // During SSR / static build there is no window, so fall back to public devnet.
    if (raw.startsWith("/")) {
      if (typeof window !== "undefined") {
        return `${window.location.origin}${raw}`;
      }
      return clusterApiUrl(network);
    }
    return raw;
  }, [network]);

  // Memoize wallets — re-instantiating breaks the adapter's listeners.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter({ network })],
    [network]
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
