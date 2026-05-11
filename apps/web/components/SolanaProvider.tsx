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

  const { endpoint, wsEndpoint } = useMemo(() => {
    const raw = process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? clusterApiUrl(network);
    const publicWs = "wss://api.devnet.solana.com";
    // Relative paths like "/api/rpc" only work in the browser.
    // During SSR / static build there is no window, so fall back to public devnet.
    if (raw.startsWith("/")) {
      if (typeof window !== "undefined") {
        // HTTP goes through the proxy; WebSocket goes directly to devnet
        // because Next.js API routes don't support WebSocket protocol upgrade.
        return { endpoint: `${window.location.origin}${raw}`, wsEndpoint: publicWs };
      }
      return { endpoint: clusterApiUrl(network), wsEndpoint: publicWs };
    }
    return { endpoint: raw, wsEndpoint: undefined };
  }, [network]);

  // Memoize wallets — re-instantiating breaks the adapter's listeners.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter({ network })],
    [network]
  );

  return (
    <ConnectionProvider endpoint={endpoint} config={wsEndpoint ? { wsEndpoint } : undefined}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
