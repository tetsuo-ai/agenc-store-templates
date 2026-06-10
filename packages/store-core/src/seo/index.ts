/**
 * `@tetsuo-ai/store-core/seo` — the SEO surface shared by every template
 * (PLAN_2 C3). JSON-LD (schema.org Service/Offer), OG/meta tags,
 * sitemap.xml/robots.txt, llms.txt, and per-listing AgentCard JSON.
 *
 * All emitters are pure string/object builders that take a {@link SeoListing} /
 * {@link SeoStoreContext} projection — so they work identically against the
 * on-chain or indexer read transport, with no `next` dependency.
 *
 * @module seo
 */
export type { SeoListing, SeoStoreContext } from "./types.js";

export {
  absoluteUrl,
  lamportsToSol,
  listingPath,
  providerPath,
  normalizeSiteUrl,
  LAMPORTS_PER_SOL,
} from "./url.js";

export {
  listingJsonLd,
  storeJsonLd,
  jsonLdScript,
  type JsonLd,
} from "./json-ld.js";

export {
  storeMetadata,
  listingMetadata,
  type PageMetadata,
} from "./meta.js";

export {
  buildSitemapEntries,
  renderSitemapXml,
  buildRobotsTxt,
  type SitemapEntry,
} from "./sitemap.js";

export {
  listingAgentCard,
  buildLlmsTxt,
  type AgentCard,
} from "./agent-card.js";

/**
 * Project a validated store config's SEO fields + name/description into the
 * {@link SeoStoreContext} the emitters consume. A template calls this once.
 */
export function storeSeoContext(input: {
  name: string;
  description: string;
  seo: {
    siteUrl: string;
    ogImage?: string;
    llmsTxt: boolean;
    jsonLd: boolean;
    sitemap: boolean;
  };
  branding?: { logo?: string };
}): import("./types.js").SeoStoreContext {
  return {
    name: input.name,
    description: input.description,
    siteUrl: input.seo.siteUrl,
    ogImage: input.seo.ogImage ?? input.branding?.logo,
    llmsTxt: input.seo.llmsTxt,
    jsonLd: input.seo.jsonLd,
    sitemap: input.seo.sitemap,
  };
}
