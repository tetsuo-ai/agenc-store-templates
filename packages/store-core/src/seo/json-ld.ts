/**
 * schema.org JSON-LD emitters (PLAN_2 C3). A listing detail page IS the SEO
 * surface (P10.3), shipped per-store. Each listing renders as a `Service` with
 * an `Offer`; the store root renders as a `Store`/`WebSite`. The returned value
 * is a plain JSON-serializable object a template drops into a
 * `<script type="application/ld+json">` tag.
 *
 * @module seo/json-ld
 */
import type { SeoListing, SeoStoreContext } from "./types.js";
import { absoluteUrl, lamportsToSol, listingPath } from "./url.js";

/** A JSON-LD document (loosely typed; structure is schema.org-shaped). */
export type JsonLd = Record<string, unknown>;

/**
 * Serialize a JSON-LD object for safe inclusion inside a
 * `<script type="application/ld+json">` tag rendered via
 * `dangerouslySetInnerHTML`.
 *
 * Untrusted listing data (a third-party provider's on-chain `name`, etc.) flows
 * into these objects. Bare `JSON.stringify` does NOT escape `<`, so a listing
 * named `</script><script>alert(1)</script>` would terminate the script tag
 * early and inject executable HTML (stored XSS). Escaping `<` to its `<`
 * unicode escape keeps the JSON valid and parseable while making a `</script>`
 * breakout impossible. `>` and `&` are escaped too as defense-in-depth (e.g.
 * against `<!--`/`]]>` sequence tricks in some parsers).
 *
 * ALWAYS use this instead of bare `JSON.stringify` when emitting JSON-LD into a
 * `<script>` via `dangerouslySetInnerHTML`.
 *
 * @param obj - The JSON-LD object (or any JSON-serializable value).
 * @returns The escaped JSON string safe to embed in a `<script>` tag.
 */
export function jsonLdScript(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/**
 * Build the schema.org `Service` + `Offer` JSON-LD for a listing detail page.
 *
 * @param listing - The listing projection.
 * @param store - Store context (for `provider`, `url`, currency).
 * @returns A JSON-LD object for `<script type="application/ld+json">`.
 */
export function listingJsonLd(
  listing: SeoListing,
  store: SeoStoreContext,
): JsonLd {
  const url = absoluteUrl(store.siteUrl, listingPath(listing.pda));
  const priceSol = lamportsToSol(listing.priceLamports);
  // SOL listings advertise SOL; SPL-priced listings advertise the mint token.
  const priceCurrency = listing.priceMint ? listing.priceMint : "SOL";

  const offer: JsonLd = {
    "@type": "Offer",
    price: priceSol,
    priceCurrency,
    availability: "https://schema.org/InStock",
    url,
  };

  const service: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: listing.name,
    url,
    serviceType: listing.category ?? "agent-service",
    provider: {
      "@type": "Organization",
      name: store.name,
      url: store.siteUrl,
    },
    offers: offer,
  };

  if (listing.description) service.description = listing.description;
  if (listing.tags && listing.tags.length > 0) {
    service.keywords = listing.tags.join(", ");
  }
  return service;
}

/**
 * Build the schema.org `Store` + `WebSite` JSON-LD for the store root page.
 *
 * @param store - Store context.
 * @returns A JSON-LD object.
 */
export function storeJsonLd(store: SeoStoreContext): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Store",
    name: store.name,
    description: store.description,
    url: store.siteUrl,
    ...(store.ogImage ? { image: store.ogImage } : {}),
    potentialAction: {
      "@type": "SearchAction",
      target: `${store.siteUrl}/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}
