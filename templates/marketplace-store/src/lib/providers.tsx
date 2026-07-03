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
 * ## Signer (HONEST scope note)
 *
 * NO wallet signer is wired here, and the template ships no wallet-connect
 * UI yet: `useWalletSigner()` only bridges a Wallet Standard wallet when a
 * caller passes it an adapter, and the `@tetsuo-ai/signer-adapters` package
 * that will provide that adapter has not shipped. Until it does (or you wire
 * `config.signer`/`config.client` yourself), the store is read-only in the
 * browser: browse/SEO/agent-cards work fully, while hire/review/activation
 * buttons remain disabled with a "connect a wallet" hint. The hire→activation
 * flow itself is exercised end to end against the real program in
 * store-core's signed lifecycle suite.
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

/**
 * Hosts that are JSON-RPC endpoints, not hosted indexers. A hosted mainnet
 * RPC in `api.baseUrl` must route to the gPA read path — treating it as an
 * indexer fires REST paths at a JSON-RPC server (403/404 and an empty
 * catalog).
 */
const RPC_HOST_PATTERN =
  /solana\.com|helius|rpcpool|quiknode|quicknode|alchemy|ankr|triton|syndica/i;

/**
 * Resolve the gPA/write RPC URL. `NEXT_PUBLIC_AGENC_RPC_URL` wins when set —
 * the per-network public defaults commonly reject browser JSON-RPC on
 * mainnet, so real deployments should provide their own endpoint.
 */
function rpcUrl(): string {
  const override = process.env.NEXT_PUBLIC_AGENC_RPC_URL;
  if (override) return override;
  const base = storeConfig.api.baseUrl;
  const isLocalRpc = base.includes("127.0.0.1") || base.includes("localhost");
  if (isLocalRpc) return base;
  if (RPC_HOST_PATTERN.test(base)) return base;
  switch (storeConfig.network) {
    case "localnet":
      return "http://127.0.0.1:8899";
    case "devnet":
      return "https://api.devnet.solana.com";
    case "mainnet":
      return "https://api.mainnet-beta.solana.com";
  }
}

/** Is `api.baseUrl` a real indexer (vs a local or hosted bare RPC)? */
function indexerBaseUrl(): string | null {
  const base = storeConfig.api.baseUrl;
  if (base.includes("127.0.0.1") || base.includes("localhost")) return null;
  if (RPC_HOST_PATTERN.test(base)) return null;
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
        // The WRITE client (and single-account reads like the WP-A1
        // roster-attestor resolution) builds from rpcUrl — pass the working
        // endpoint explicitly instead of the per-network default.
        rpcUrl: rpcUrl(),
        indexer: { baseUrl: indexer, apiKey: storeConfig.api.apiKey },
        referrer,
      };
    }
    // gPA / localnet: build the read transport explicitly and pass it through
    // the `queryTransport` seam.
    return {
      network: storeConfig.network,
      rpcUrl: rpcUrl(),
      queryTransport: createReadTransport({ rpc: createSolanaRpc(rpcUrl()) }),
      referrer,
    };
  }, []);

  return <AgencProvider config={config}>{children}</AgencProvider>;
}
