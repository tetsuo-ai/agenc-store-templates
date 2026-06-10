/**
 * Structural SEO-surface test (PLAN_2 C3 Done-when: "JSON-LD validates; llms.txt
 * serves; assert structurally in a test").
 *
 * The templates emit their SEO surface through `@tetsuo-ai/store-core/seo`. This
 * test exercises those emitters with a realistic store context + fixture
 * listings (the same shape the templates project from the on-chain book) and
 * asserts the output is STRUCTURALLY valid schema.org / AgentCard / sitemap /
 * llms.txt — so a regression in the SEO surface fails CI without a browser.
 *
 * (A live Lighthouse SEO/a11y >= 95 run is browser-gated; this guards the
 * structural contract those scores depend on.)
 */
import { describe, expect, it } from "vitest";
import {
  storeJsonLd,
  listingJsonLd,
  listingAgentCard,
  buildLlmsTxt,
  buildSitemapEntries,
  renderSitemapXml,
  buildRobotsTxt,
  storeMetadata,
  listingMetadata,
  storeSeoContext,
  type SeoListing,
  type SeoStoreContext,
} from "@tetsuo-ai/store-core/seo";

const store: SeoStoreContext = storeSeoContext({
  name: "Acme Agent Store",
  description: "Hire vetted AI agents with on-chain escrow on Solana.",
  seo: {
    siteUrl: "https://store.example.com",
    ogImage: "https://store.example.com/og.png",
    jsonLd: true,
    sitemap: true,
    llmsTxt: true,
  },
});

const listing: SeoListing = {
  pda: "7RkbpXC7sPVNYSLVkaxChHgXNa4J8B4kgBhzRZzjTkHc",
  name: "Sandbox Analyst",
  category: "data-analysis",
  tags: ["sandbox", "csv"],
  description: "Analyzes CSV data and returns insights.",
  priceLamports: 1_000_000n,
  priceMint: null,
  provider: "H66R3iFjeYj2sweCiFuJXNHz2NhjpFDHKjRNsPznDLC8",
};

const listings: SeoListing[] = [listing];

describe("store JSON-LD", () => {
  it("is a valid schema.org Store node", () => {
    const ld = storeJsonLd(store);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Store");
    expect(ld.name).toBe("Acme Agent Store");
    expect(ld.url).toBe("https://store.example.com");
    // Round-trips through JSON (a template embeds it via JSON.stringify).
    expect(() => JSON.parse(JSON.stringify(ld))).not.toThrow();
  });
});

describe("listing JSON-LD (the per-store SEO surface)", () => {
  it("is a valid schema.org Service with a nested Offer", () => {
    const ld = listingJsonLd(listing, store);
    expect(ld["@type"]).toBe("Service");
    expect(ld.name).toBe("Sandbox Analyst");
    const offer = ld.offers as Record<string, unknown>;
    expect(offer["@type"]).toBe("Offer");
    expect(offer.price).toBe("0.001"); // 1_000_000 lamports -> SOL
    expect(offer.priceCurrency).toBe("SOL");
    expect(offer.availability).toBe("https://schema.org/InStock");
    expect(String(offer.url)).toContain(listing.pda);
    expect(() => JSON.parse(JSON.stringify(ld))).not.toThrow();
  });
});

describe("AgentCard JSON", () => {
  it("describes the hireable action with a canonical target", () => {
    const card = listingAgentCard(listing, store);
    expect(card.schema).toBe("agenc.agent-card/v1");
    expect(card.pda).toBe(listing.pda);
    expect(card.price.sol).toBe("0.001");
    expect(card.price.lamports).toBe("1000000");
    expect(card.action.type).toBe("hire");
    expect(card.action.href).toContain(`/listings/${listing.pda}`);
    expect(card.url.startsWith("https://store.example.com")).toBe(true);
  });
});

describe("llms.txt", () => {
  it("serves the store header + every listing with its URL + price", () => {
    const body = buildLlmsTxt(store, listings);
    expect(body).toContain("# Acme Agent Store");
    expect(body).toContain(store.description);
    expect(body).toContain(listing.name);
    expect(body).toContain(`/listings/${listing.pda}`);
    expect(body).toContain("0.001 SOL");
    // Ends with a trailing newline (well-formed text file).
    expect(body.endsWith("\n")).toBe(true);
  });

  it("renders a valid empty manifest when there is no supply", () => {
    const body = buildLlmsTxt(store, []);
    expect(body).toContain("_No listings are currently live._");
  });
});

describe("sitemap + robots", () => {
  it("includes the static pages + a per-listing + per-provider entry", () => {
    const entries = buildSitemapEntries(store, listings);
    const urls = entries.map((e) => e.url);
    expect(urls).toContain("https://store.example.com/");
    expect(urls).toContain("https://store.example.com/trust");
    expect(urls.some((u) => u.includes(`/listings/${listing.pda}`))).toBe(true);
    expect(urls.some((u) => u.includes(listing.provider!))).toBe(true);
  });

  it("renders well-formed sitemap XML", () => {
    const xml = renderSitemapXml(buildSitemapEntries(store, listings));
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml).toContain("<urlset");
    expect(xml).toContain("<loc>https://store.example.com/</loc>");
    // Balanced url tags.
    const open = (xml.match(/<url>/g) ?? []).length;
    const close = (xml.match(/<\/url>/g) ?? []).length;
    expect(open).toBe(close);
    expect(open).toBeGreaterThan(0);
  });

  it("robots.txt points at the sitemap + the llms manifest", () => {
    const robots = buildRobotsTxt(store);
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Sitemap: https://store.example.com/sitemap.xml");
    expect(robots).toContain("/llms.txt");
  });
});

describe("page metadata (OG/canonical)", () => {
  it("store metadata carries title + canonical + OG", () => {
    const meta = storeMetadata(store);
    expect(meta.title).toBe("Acme Agent Store");
    expect(meta.alternates?.canonical).toBe("https://store.example.com");
    expect(meta.openGraph?.url).toBe("https://store.example.com");
    expect(meta.openGraph?.images?.[0]?.url).toContain("og.png");
  });

  it("listing metadata canonical points at the listing", () => {
    const meta = listingMetadata(listing, store);
    expect(meta.title).toContain("Sandbox Analyst");
    expect(meta.alternates?.canonical).toContain(`/listings/${listing.pda}`);
    expect(meta.twitter?.card).toBe("summary_large_image");
  });
});
