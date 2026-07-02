/**
 * `<Providers>` — the client boundary that mounts `<AgencProvider>` above the
 * whole app. It wires reads (indexer-first + gPA fallback), the referrer config
 * (validated + stored + disclosed + INJECTED into every hire at the provider
 * level — referral settlement is live on-chain), and the network.
 *
 * ## Read transport
 *
 * `AgencProvider` derives its read transport from `config.indexer` or
 * `config.queryTransport` only — it does NOT (v1) build a kit RPC from a bare
 * `rpcUrl`. So for the gPA / localnet path we construct the read transport here
 * with `createReadTransport({ rpc })` and pass it as `queryTransport`. When
 * `api.baseUrl` is a real hosted indexer we pass `indexer` and let the provider
 * resolve indexer-first.
 *
 * The signer is NOT wired here: wallet connection is a buyer action surfaced on
 * the pages that need it (`useWalletSigner` bridges Wallet Standard when the
 * buyer connects). A read-only browse + SEO render needs no signer.
 */
"use client";
import { useMemo, type ReactNode } from "react";
import {
  AgencProvider,
  createReadTransport,
  type AgencProviderConfig,
} from "@tetsuo-ai/marketplace-react";
import { createSolanaRpc } from "@solana/kit";
import "@tetsuo-ai/marketplace-react/theme.css";
import "@tetsuo-ai/marketplace-react/components.css";
import { storeConfig } from "./config";

/** Resolve the gPA RPC URL for the configured network. */
function rpcUrl(): string {
  const base = storeConfig.api.baseUrl;
  const isLocalRpc = base.includes("127.0.0.1") || base.includes("localhost");
  if (isLocalRpc) return base;
  switch (storeConfig.network) {
    case "localnet":
      return "http://127.0.0.1:8899";
    case "devnet":
      return "https://api.devnet.solana.com";
    case "mainnet":
      return "https://api.mainnet-beta.solana.com";
  }
}

/** Is `api.baseUrl` a real indexer (vs the bare RPC)? */
function indexerBaseUrl(): string | null {
  const base = storeConfig.api.baseUrl;
  if (base.includes("127.0.0.1") || base.includes("localhost")) return null;
  return base;
}

export function Providers({ children }: { children: ReactNode }) {
  const config = useMemo<AgencProviderConfig>(() => {
    const indexer = indexerBaseUrl();
    // Referrer: validated + stored + disclosed + injected into every hire by
    // the provider (referral settlement is live on-chain). Earnings are read
    // from chain, never faked.
    const referrer = {
      wallet: storeConfig.referrer.wallet,
      feeBps: storeConfig.referrer.feeBps,
    };
    if (indexer) {
      return {
        network: storeConfig.network,
        indexer: { baseUrl: indexer, apiKey: storeConfig.api.apiKey },
        referrer,
      };
    }
    // gPA / localnet: build the read transport explicitly and pass it through
    // the `queryTransport` seam.
    return {
      network: storeConfig.network,
      queryTransport: createReadTransport({ rpc: createSolanaRpc(rpcUrl()) }),
      referrer,
    };
  }, []);

  return <AgencProvider config={config}>{children}</AgencProvider>;
}
