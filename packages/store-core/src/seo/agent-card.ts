/**
 * `llms.txt` + per-listing AgentCard JSON emitters (PLAN_2 C3). These let agent
 * crawlers discover and act on the store's supply.
 *
 * The AgentCard schema is `agenc.agentCard.v1` — the SAME schema agenc.ag's
 * production `/listings/[pda]/agent-card.json` route emits, so a crawler that
 * understands one AgenC surface understands every store. The shape is defined
 * ONCE (WP-F4) as the JSON Schema document served at
 * {@link AGENT_CARD_SCHEMA_URL} and vendored byte-identically into this
 * package at `schemas/agenc.agentCard.v1.json` (guarded by a byte-equality
 * fixture test — the sharing mechanism until a shared schema package exists).
 *
 * Emit is ALWAYS the unified id. The pre-unification `agenc.agent-card/v1`
 * id/shape (WP-B1 removed the emitter) is still ACCEPTED on read by
 * {@link parseAgentCard} for one minor version — deprecated, removal in
 * store-core 0.7.0 (deferred past 0.6.0 — the roster-trust release keeps the
 * read path) per the deprecation conventions in agenc-protocol
 * docs/VERSIONING.md.
 *
 * - `llms.txt` is a plain-text manifest pointing crawlers at the catalog and
 *   each listing's detail/AgentCard URL.
 * - The per-listing AgentCard JSON describes the hireable listing in the
 *   unified machine-readable shape (identity, price, store attribution,
 *   hireability).
 *
 * @module seo/agent-card
 */
import type { SeoListing, SeoStoreContext } from "./types.js";
import { absoluteUrl, lamportsToSol, listingPath } from "./url.js";

/** The unified AgentCard schema marker (matches agenc.ag production). */
export const AGENT_CARD_SCHEMA = "agenc.agentCard.v1" as const;

/**
 * The canonical URL of the `agenc.agentCard.v1` JSON Schema document — the
 * single definition of the card shape. This package vendors a byte-identical
 * copy at `schemas/agenc.agentCard.v1.json`.
 */
export const AGENT_CARD_SCHEMA_URL =
  "https://agenc.ag/schemas/agenc.agentCard.v1.json" as const;

/**
 * @deprecated The pre-unification store-core schema id. Accepted on READ by
 * {@link parseAgentCard} through store-core 0.6.x only (removal: 0.7.0, per
 * agenc-protocol docs/VERSIONING.md deprecation conventions). Never emitted.
 */
export const AGENT_CARD_LEGACY_SCHEMA = "agenc.agent-card/v1" as const;

/** The price shape of an {@link AgentCard} (SOL or SPL-token pricing). */
export type AgentCardPrice =
  | { amount: string; currency: "SOL" }
  | { amountRaw: string; currency: "SPL_TOKEN"; mint: string };

/** Store attribution on an {@link AgentCard}. */
export interface AgentCardStore {
  /** Stable store handle (slug). */
  handle: string;
  /** Store display title. */
  title: string;
  /** Store origin URL. */
  url: string;
  /** The store's referral fee in basis points. */
  referrerFeeBps: number;
}

/** Hireability verdict on an {@link AgentCard}. */
export interface AgentCardHireability {
  /** UI state token (e.g. `"hireable"`). */
  uiState: string;
  /** Whether the listing is hireable through this store right now. */
  hireable: boolean;
  /** Machine-readable blockers when not hireable. */
  blockers: string[];
}

/**
 * A machine-readable card describing one hireable listing — the unified
 * `agenc.agentCard.v1` shape shared with agenc.ag.
 */
export interface AgentCard {
  /** Schema marker for consumers. */
  schema: typeof AGENT_CARD_SCHEMA;
  /** The ServiceListing PDA — the stable id. */
  id: string;
  /** Canonical detail URL (the hire action target). */
  url: string;
  /** Display name (on-chain listing name, or the truncated PDA). */
  name: string;
  /** Long description, when available. */
  description: string | null;
  /**
   * Metadata provenance. Store templates read the on-chain listing directly
   * and have no verified-metadata registry, so this is `"unverified"`; the
   * text fields carry the decoded on-chain values.
   */
  metadataState: string;
  /** Category token, when available. */
  category: string | null;
  /** Discovery tags. */
  tags: string[];
  /** Deliverables, when known (empty for on-chain-only listings). */
  deliverables: string[];
  /** Required buyer inputs, when known. */
  buyerInputs: string[];
  /** Example outputs, when known. */
  examples: string[];
  /** Service-level agreement text, when known. */
  sla: string | null;
  /** Price (SOL decimal or raw SPL amount + mint). */
  price: AgentCardPrice;
  /** The provider agent PDA. */
  providerAgent: string | null;
  /** Store attribution (this store), or null. */
  store: AgentCardStore | null;
  /** Hireability verdict. */
  hireability: AgentCardHireability;
}

/** Options for {@link listingAgentCard}. */
export interface ListingAgentCardOptions {
  /**
   * The store's referral fee in bps — emitted in the card's `store` block so
   * the earning party is machine-visible. Omit to emit `store: null`.
   */
  referrerFeeBps?: number;
  /** Hireability override. Defaults to hireable (curated listings only). */
  hireability?: AgentCardHireability;
}

/** Slugify a store name into a stable handle. */
function storeHandle(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "store";
}

/**
 * Neutralize a string for safe inclusion as the text of a markdown link
 * (`[<text>](url)`). The listing `name` is untrusted on-chain data (a
 * third-party provider's UTF-8 bytes, no charset restriction beyond a 32-byte
 * cap), so a name containing `[`, `]`, `(`, `)`, or a newline could break the
 * `/llms.txt` link or inject extra markdown structure (e.g. redirect an agent
 * crawler to an attacker URL, or fragment the manifest with a forged heading).
 * Escaping the bracket/paren metacharacters and collapsing CR/LF to a space
 * keeps the link text legible while making link/structure injection impossible.
 *
 * @param value - The untrusted display name.
 * @returns The name safe to interpolate inside markdown-link text.
 */
function escapeMarkdownLinkText(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/([[\]()])/g, "\\$1");
}

/**
 * Build the unified `agenc.agentCard.v1` JSON for one listing.
 *
 * @param listing - The listing projection.
 * @param store - Store context (for absolute URLs + attribution).
 * @param options - Referrer fee + hireability ({@link ListingAgentCardOptions}).
 * @returns An {@link AgentCard}.
 */
export function listingAgentCard(
  listing: SeoListing,
  store: SeoStoreContext,
  options: ListingAgentCardOptions = {},
): AgentCard {
  const url = absoluteUrl(store.siteUrl, listingPath(listing.pda));
  const lamports =
    listing.priceLamports === undefined || listing.priceLamports === null
      ? "0"
      : String(listing.priceLamports);
  const price: AgentCardPrice = listing.priceMint
    ? { amountRaw: lamports, currency: "SPL_TOKEN", mint: listing.priceMint }
    : { amount: lamportsToSol(listing.priceLamports), currency: "SOL" };

  const fallbackName = `Service ${listing.pda.slice(0, 6)}…${listing.pda.slice(-6)}`;

  return {
    schema: AGENT_CARD_SCHEMA,
    id: listing.pda,
    url,
    name: listing.name.trim() || fallbackName,
    description: listing.description ?? null,
    metadataState: "unverified",
    category: listing.category ?? null,
    tags: listing.tags ?? [],
    deliverables: [],
    buyerInputs: [],
    examples: [],
    sla: null,
    price,
    providerAgent: listing.provider ?? null,
    store:
      options.referrerFeeBps === undefined
        ? null
        : {
            handle: storeHandle(store.name),
            title: store.name,
            url: store.siteUrl.replace(/\/+$/, ""),
            referrerFeeBps: options.referrerFeeBps,
          },
    hireability:
      options.hireability ?? { uiState: "hireable", hireable: true, blockers: [] },
  };
}

/**
 * Build the `/llms.txt` manifest body. Points agent crawlers at the catalog and
 * lists each listing with its detail URL (which serves the AgentCard).
 *
 * @param store - Store context.
 * @param listings - The (curated) listings to advertise.
 * @returns The `llms.txt` body.
 */
export function buildLlmsTxt(
  store: SeoStoreContext,
  listings: readonly SeoListing[],
): string {
  const lines: string[] = [];
  lines.push(`# ${store.name}`);
  lines.push("");
  lines.push(`> ${store.description}`);
  lines.push("");
  lines.push(
    "This is an AgenC agent store. Every listing below is a hireable agent " +
      "service settled on Solana with on-chain escrow. Each listing exposes a " +
      "machine-readable AgentCard (JSON, schema agenc.agentCard.v1) at its " +
      "detail URL.",
  );
  lines.push("");
  lines.push("## Listings");
  lines.push("");
  if (listings.length === 0) {
    lines.push("_No listings are currently live._");
  } else {
    for (const listing of listings) {
      const url = absoluteUrl(store.siteUrl, listingPath(listing.pda));
      const priceSol = lamportsToSol(listing.priceLamports);
      const cat = listing.category ? ` [${listing.category}]` : "";
      const name = escapeMarkdownLinkText(listing.name);
      lines.push(`- [${name}](${url})${cat} — ${priceSol} SOL`);
    }
  }
  lines.push("");
  lines.push("## Trust");
  lines.push("");
  lines.push(
    `Buyer protections (escrow, completion bonds, disputes) and the store's ` +
      `fee disclosure are documented at ${absoluteUrl(store.siteUrl, "/trust")}.`,
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Reading cards (WP-F4): unified id always; legacy id accepted, up-converted
// ---------------------------------------------------------------------------

/**
 * The pre-unification `agenc.agent-card/v1` wire shape, kept ONLY so
 * {@link parseAgentCard} can up-convert cards emitted by pre-WP-B1 stores
 * still deployed in the wild.
 *
 * @deprecated Read-only compatibility shape; removal with
 * {@link AGENT_CARD_LEGACY_SCHEMA} in store-core 0.7.0.
 */
interface LegacyAgentCard {
  schema: typeof AGENT_CARD_LEGACY_SCHEMA;
  pda: string;
  name: string;
  category?: string;
  tags?: string[];
  description?: string;
  price: { sol: string; lamports: string; mint: string | null };
  provider?: string;
  url: string;
  action: { type: "hire"; href: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isUnifiedPrice(value: unknown): value is AgentCardPrice {
  if (!isRecord(value)) return false;
  if (value.currency === "SOL") return typeof value.amount === "string";
  if (value.currency === "SPL_TOKEN") {
    return typeof value.amountRaw === "string" && typeof value.mint === "string";
  }
  return false;
}

function isUnifiedAgentCard(value: Record<string, unknown>): value is Record<string, unknown> & AgentCard {
  const hireability = value.hireability;
  const store = value.store;
  return (
    value.schema === AGENT_CARD_SCHEMA &&
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    typeof value.name === "string" &&
    (typeof value.description === "string" || value.description === null) &&
    typeof value.metadataState === "string" &&
    (typeof value.category === "string" || value.category === null) &&
    isStringArray(value.tags) &&
    isStringArray(value.deliverables) &&
    isStringArray(value.buyerInputs) &&
    isStringArray(value.examples) &&
    (typeof value.sla === "string" || value.sla === null) &&
    isUnifiedPrice(value.price) &&
    (typeof value.providerAgent === "string" || value.providerAgent === null) &&
    (store === null ||
      (isRecord(store) &&
        typeof store.handle === "string" &&
        typeof store.title === "string" &&
        typeof store.url === "string" &&
        typeof store.referrerFeeBps === "number")) &&
    isRecord(hireability) &&
    typeof hireability.uiState === "string" &&
    typeof hireability.hireable === "boolean" &&
    isStringArray(hireability.blockers)
  );
}

function isLegacyAgentCard(value: Record<string, unknown>): value is Record<string, unknown> & LegacyAgentCard {
  const price = value.price;
  return (
    value.schema === AGENT_CARD_LEGACY_SCHEMA &&
    typeof value.pda === "string" &&
    typeof value.name === "string" &&
    typeof value.url === "string" &&
    isRecord(price) &&
    typeof price.sol === "string" &&
    typeof price.lamports === "string" &&
    (typeof price.mint === "string" || price.mint === null)
  );
}

/**
 * Parse an untrusted value as an agent card (WP-F4 read path).
 *
 * Accepts the unified `agenc.agentCard.v1` shape, and — DEPRECATED, through
 * store-core 0.6.x only (removal: 0.7.0, per agenc-protocol
 * docs/VERSIONING.md) — the pre-unification `agenc.agent-card/v1` shape,
 * which is up-converted so callers only ever see the unified shape. The
 * returned card ALWAYS carries `schema: "agenc.agentCard.v1"`; re-emitting a
 * parsed card therefore always emits the unified id.
 *
 * @param value - The untrusted JSON value (e.g. a fetched agent-card body).
 * @returns The unified {@link AgentCard}, or null when the value is neither
 *   a structurally valid unified card nor a structurally valid legacy card.
 */
export function parseAgentCard(value: unknown): AgentCard | null {
  if (!isRecord(value)) return null;
  if (isUnifiedAgentCard(value)) {
    return { ...(value as AgentCard), schema: AGENT_CARD_SCHEMA };
  }
  if (isLegacyAgentCard(value)) {
    const legacy = value as LegacyAgentCard;
    return {
      schema: AGENT_CARD_SCHEMA,
      id: legacy.pda,
      url: legacy.url,
      name: legacy.name,
      description: legacy.description ?? null,
      metadataState: "unverified",
      category: legacy.category ?? null,
      tags: isStringArray(legacy.tags) ? legacy.tags : [],
      deliverables: [],
      buyerInputs: [],
      examples: [],
      sla: null,
      price: legacy.price.mint
        ? {
            amountRaw: legacy.price.lamports,
            currency: "SPL_TOKEN",
            mint: legacy.price.mint,
          }
        : { amount: legacy.price.sol, currency: "SOL" },
      providerAgent: legacy.provider ?? null,
      store: null,
      hireability: { uiState: "hireable", hireable: true, blockers: [] },
    };
  }
  return null;
}
