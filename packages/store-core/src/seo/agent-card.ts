/**
 * `llms.txt` + per-listing AgentCard JSON emitters (PLAN_2 C3). These let agent
 * crawlers discover and act on the store's supply.
 *
 * The AgentCard schema is `agenc.agentCard.v1` — the SAME schema agenc.ag's
 * production `/listings/[pda]/agent-card.json` route emits, so a crawler that
 * understands one AgenC surface understands every store. (The pre-unification
 * `agenc.agent-card/v1` shape is gone; WP-B1 picked ONE schema.)
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
