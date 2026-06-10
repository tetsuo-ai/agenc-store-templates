/**
 * Server-side store reads (SSR + SEO surfaces). Pages that emit SEO artifacts —
 * the listing-detail metadata + JSON-LD, the sitemap, llms.txt, and the
 * per-listing AgentCard JSON — need the on-chain catalog at request/build time,
 * NOT only client-side.
 *
 * This module reads through the **SDK directly** (not `marketplace-react`),
 * deliberately: `marketplace-react`'s root entry bundles client components that
 * call `React.createContext` at module scope, which crashes a React Server
 * Component build. The SDK is framework-free — `listActiveListings`,
 * `createIndexerClient`, and the `values.decode*` helpers are pure functions.
 *
 * Indexer-first (when `api.baseUrl` is a real indexer) with a kit-RPC gPA
 * fallback. Listings are projected into the transport-agnostic `SeoListing`
 * shape the `store-core/seo` helpers consume.
 *
 * This is layout/SEO glue — no protocol/hire logic (that all lives in
 * `store-core` + `marketplace-react`, the C1 rule).
 */
import "server-only";
import {
  createIndexerClient,
  listActiveListings,
  values,
  type DecodedProgramAccount,
  type ServiceListing,
} from "@tetsuo-ai/marketplace-sdk";
import { createSolanaRpc } from "@solana/kit";
import {
  getDeployedSurface,
  applyCuration,
  type DeployedSurface,
  type CurateableListing,
} from "@tetsuo-ai/store-core/config";
import type { SeoListing } from "@tetsuo-ai/store-core/seo";
import { storeConfig } from "./config";

/** Default localnet RPC for the gPA fallback when no indexer is configured. */
const LOCALNET_RPC = "http://127.0.0.1:8899";

/** Resolve the gPA read source URL for the configured network. */
function rpcUrl(): string {
  switch (storeConfig.network) {
    case "localnet":
      return process.env.AGENC_RPC_URL ?? LOCALNET_RPC;
    case "devnet":
      return process.env.AGENC_RPC_URL ?? "https://api.devnet.solana.com";
    case "mainnet":
      return process.env.AGENC_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  }
}

/**
 * Is `api.baseUrl` a real indexer endpoint, or just the bare RPC? On localnet it
 * defaults to the RPC (not an indexer), so we route reads to the gPA path.
 */
function indexerBaseUrl(): string | null {
  const baseUrl = storeConfig.api.baseUrl;
  if (baseUrl === rpcUrl() || baseUrl === LOCALNET_RPC) return null;
  if (baseUrl.includes("127.0.0.1") || baseUrl.includes("localhost")) return null;
  return baseUrl;
}


/** Decode a NUL-padded byte field to a trimmed string (tolerant of garbage). */
function decodeName(account: ServiceListing): string {
  try {
    return values.decodeListingName(Uint8Array.from(account.name));
  } catch {
    return "";
  }
}
function decodeCategory(account: ServiceListing): string {
  try {
    return values.decodeListingCategory(Uint8Array.from(account.category));
  } catch {
    return "";
  }
}
function decodeTags(account: ServiceListing): string[] {
  try {
    return values.decodeListingTags(Uint8Array.from(account.tags));
  } catch {
    return [];
  }
}

/** Project a decoded on-chain listing into the SEO/AgentCard shape. */
function toSeoListing(row: DecodedProgramAccount<ServiceListing>): SeoListing {
  const account = row.account;
  const category = decodeCategory(account) || undefined;
  const tags = decodeTags(account);
  const listing: SeoListing = {
    pda: String(row.address),
    name: decodeName(account),
    priceLamports: account.price,
    provider: String(account.providerAgent),
    specUri: account.specUri,
  };
  if (category) listing.category = category;
  if (tags.length > 0) listing.tags = tags;
  const mint = account.priceMint;
  // `priceMint` is a kit Option<Address> ({ __option, value }) — surface only Some.
  if (mint && typeof mint === "object" && "value" in mint && mint.value) {
    listing.priceMint = String(mint.value);
  }
  return listing;
}

/** Map a decoded listing to the curation filter's minimal shape. */
function toCurateable(row: DecodedProgramAccount<ServiceListing>): CurateableListing {
  const category = decodeCategory(row.account) || undefined;
  return {
    address: String(row.address),
    providerAgent: String(row.account.providerAgent),
    ...(category ? { category } : {}),
  };
}

/**
 * List all Active listings: through the hosted indexer client when `api.baseUrl`
 * is a real indexer, otherwise via the kit-RPC gPA path. Both return the SAME
 * `DecodedProgramAccount<ServiceListing>` shape.
 */
async function listAll(): Promise<Array<DecodedProgramAccount<ServiceListing>>> {
  const base = indexerBaseUrl();
  if (base) {
    const indexer = createIndexerClient({
      baseUrl: base,
      apiKey: storeConfig.api.apiKey,
    });
    return indexer.listActiveListings();
  }
  return listActiveListings(createSolanaRpc(rpcUrl()));
}

/**
 * Load the store's CURATED listings, server-side, as `SeoListing[]`. Applies the
 * same curation the client catalog applies, so the SEO surface advertises
 * exactly the carried catalog. Degrades to `[]` on any transport error.
 */
export async function loadStoreListings(): Promise<SeoListing[]> {
  try {
    const rows = await listAll();
    const indexed = new Map(rows.map((r) => [String(r.address), r]));
    const curated = applyCuration(rows.map(toCurateable), storeConfig.curation);
    return curated
      .map((c) => indexed.get(c.address))
      .filter((r): r is DecodedProgramAccount<ServiceListing> => r !== undefined)
      .map(toSeoListing);
  } catch {
    return [];
  }
}

/** Load one listing's SEO projection by PDA (or null if not found). */
export async function loadListing(pda: string): Promise<SeoListing | null> {
  try {
    const rows = await listAll();
    const row = rows.find((r) => String(r.address) === pda);
    return row ? toSeoListing(row) : null;
  } catch {
    return null;
  }
}

/**
 * Resolve whether the store's catalog surface is live on the target cluster
 * (the C2 surface-check / P6.5 path). Drives the explicit not-deployed page.
 */
export async function loadDeployedSurface(): Promise<DeployedSurface> {
  return getDeployedSurface(storeConfig, {
    listActiveListings: () => listAll(),
  });
}
