/**
 * `llms.txt` + per-listing AgentCard JSON emitters (PLAN_2 C3). These let agent
 * crawlers discover and act on the store's supply — shared implementation with
 * P10.3/P5.4's AgentCard work.
 *
 * - `llms.txt` is a plain-text manifest pointing crawlers at the catalog and
 *   each listing's AgentCard.
 * - The per-listing AgentCard JSON describes the hireable action in a
 *   machine-readable shape (name, price, the `/listings/[pda]` action target).
 *
 * @module seo/agent-card
 */
import type { SeoListing, SeoStoreContext } from "./types.js";
import { absoluteUrl, lamportsToSol, listingPath } from "./url.js";

/** A machine-readable card describing one hireable listing. */
export interface AgentCard {
  /** Schema marker for consumers. */
  schema: "agenc.agent-card/v1";
  /** The ServiceListing PDA — the stable id. */
  pda: string;
  /** Display name. */
  name: string;
  /** Category token. */
  category?: string;
  /** Discovery tags. */
  tags?: string[];
  /** Human-readable description. */
  description?: string;
  /** Price in SOL (decimal string) and the raw lamport amount. */
  price: { sol: string; lamports: string; mint: string | null };
  /** The provider agent PDA. */
  provider?: string;
  /** Canonical detail URL (the hire action target). */
  url: string;
  /** The hireable action descriptor. */
  action: { type: "hire"; href: string };
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
 * Build the AgentCard JSON for one listing.
 *
 * @param listing - The listing projection.
 * @param store - Store context (for absolute URLs).
 * @returns An {@link AgentCard}.
 */
export function listingAgentCard(
  listing: SeoListing,
  store: SeoStoreContext,
): AgentCard {
  const url = absoluteUrl(store.siteUrl, listingPath(listing.pda));
  const lamports =
    listing.priceLamports === undefined || listing.priceLamports === null
      ? "0"
      : String(listing.priceLamports);
  const card: AgentCard = {
    schema: "agenc.agent-card/v1",
    pda: listing.pda,
    name: listing.name,
    price: {
      sol: lamportsToSol(listing.priceLamports),
      lamports,
      mint: listing.priceMint ?? null,
    },
    url,
    action: { type: "hire", href: url },
  };
  if (listing.category) card.category = listing.category;
  if (listing.tags && listing.tags.length > 0) card.tags = listing.tags;
  if (listing.description) card.description = listing.description;
  if (listing.provider) card.provider = listing.provider;
  return card;
}

/**
 * Build the `/llms.txt` manifest body. Points agent crawlers at the catalog and
 * lists each listing with its AgentCard URL.
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
      "machine-readable AgentCard (JSON) at its detail URL.",
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
