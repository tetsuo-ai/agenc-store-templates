/**
 * Shared input shapes for the SEO helpers (PLAN_2 C3). These are deliberately
 * transport-agnostic: a template projects either a decoded on-chain
 * `ServiceListing` or the indexer's `IndexerListingDecoded` into a
 * {@link SeoListing} before calling a helper, so the SEO surface never depends
 * on which read transport served the data.
 *
 * @module seo/types
 */

/**
 * The minimal listing projection the SEO helpers consume. Lamport prices are
 * passed as `bigint | string` (u64-safe) and converted to SOL for display.
 */
export interface SeoListing {
  /** The ServiceListing PDA — the canonical id for `/listings/[pda]`. */
  pda: string;
  /** Display name. */
  name: string;
  /** Category token (lowercase-kebab). */
  category?: string;
  /** Discovery tags. */
  tags?: string[];
  /** Human-readable description / spec summary (for JSON-LD + AgentCard). */
  description?: string;
  /** Price in lamports (u64-safe). */
  priceLamports?: bigint | string | number;
  /** SPL price mint, or null/undefined for SOL. */
  priceMint?: string | null;
  /** The provider agent PDA. */
  provider?: string;
  /** The job-spec URI (AgentCard action target hint). */
  specUri?: string;
}

/** Store-level context every SEO emitter needs. */
export interface SeoStoreContext {
  /** Store display name. */
  name: string;
  /** Store description. */
  description: string;
  /** Canonical site origin (no trailing slash is required; normalized). */
  siteUrl: string;
  /** OG image URL, when configured. */
  ogImage?: string;
  /** Whether `/llms.txt` is enabled. */
  llmsTxt: boolean;
  /** Whether JSON-LD is enabled. */
  jsonLd: boolean;
  /** Whether `/sitemap.xml` is enabled. */
  sitemap: boolean;
}
