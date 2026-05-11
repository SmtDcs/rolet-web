"use client";

import { ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { clusterApiUrl } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";

export function SolanaProvider({ children }: { children: ReactNode }) {
  const network =
    (process.env.NEXT_PUBLIC_SOLANA_NETWORK as WalletAdapterNetwork) ??
    WalletAdapterNetwork.Devnet;

  const { endpoint, config } = useMemo(() => {
    const rpcEndpoint = process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? clusterApiUrl(network);
    const apiKey = process.env.NEXT_PUBLIC_RPCFAST_API_KEY ?? "";
    // Always use public devnet WebSocket — Next.js API routes don't upgrade to WS,
    // and browser WebSocket can't set custom auth headers.
    const wsEndpoint = "wss://api.devnet.solana.com";

    // Relative path = legacy proxy route. Resolve to absolute for the browser.
    if (rpcEndpoint.startsWith("/")) {
      const base =
        typeof window !== "undefined"
          ? `${window.location.origin}${rpcEndpoint}`
          : clusterApiUrl(network);
      return { endpoint: base, config: { wsEndpoint } };
    }

    // Direct RPC Fast endpoint: attach X-Token header so the browser talks
    // directly to RPC Fast without a proxy hop, cutting confirmation latency.
    const httpHeaders = apiKey ? { "X-Token": apiKey } : undefined;
    return { endpoint: rpcEndpoint, config: { wsEndpoint, ...(httpHeaders && { httpHeaders }) } };
  }, [network]);

  const wallets = useMemo(
    () => [new SolflareWalletAdapter({ network })],
    [network]
  );

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
