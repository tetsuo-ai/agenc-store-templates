/**
 * SEO emitter tests (PLAN_2 C3): JSON-LD (Service/Offer), OG/meta, sitemap,
 * robots, llms.txt, per-listing AgentCard. Asserts the structural contract a
 * Lighthouse/JSON-LD validator would check.
 */
import { describe, it, expect } from "vitest";
import {
  listingJsonLd,
  storeJsonLd,
  jsonLdScript,
  storeMetadata,
  listingMetadata,
  buildSitemapEntries,
  renderSitemapXml,
  buildRobotsTxt,
  listingAgentCard,
  buildLlmsTxt,
  lamportsToSol,
  type SeoListing,
  type SeoStoreContext,
} from "../src/seo/index.js";
import { LISTING_A, LISTING_B, PROVIDER_A } from "./fixtures.js";

const store: SeoStoreContext = {
  name: "Acme Agent Store",
  description: "Hire vetted agents.",
  siteUrl: "https://store.example.com",
  ogImage: "https://store.example.com/og.png",
  llmsTxt: true,
  jsonLd: true,
  sitemap: true,
};

const listing: SeoListing = {
  pda: LISTING_A,
  name: "Sandbox Analyst",
  category: "data-analysis",
  tags: ["sql", "charts"],
  description: "Turns raw CSVs into a report.",
  priceLamports: 1_000_000n,
  priceMint: null,
  provider: PROVIDER_A,
  specUri: "ipfs://spec",
};

const listings: SeoListing[] = [
  listing,
  {
    pda: LISTING_B,
    name: "Sandbox Codegen",
    category: "code-generation",
    priceLamports: 5_000_000,
    provider: PROVIDER_A,
  },
];

describe("lamportsToSol", () => {
  it("converts lamports to a trimmed SOL string", () => {
    expect(lamportsToSol(1_000_000_000n)).toBe("1");
    expect(lamportsToSol(1_000_000n)).toBe("0.001");
    expect(lamportsToSol(1_500_000_000)).toBe("1.5");
    expect(lamportsToSol("0")).toBe("0");
    expect(lamportsToSol(undefined)).toBe("0");
  });
});

describe("JSON-LD", () => {
  it("emits a schema.org Service with an Offer for a listing", () => {
    const ld = listingJsonLd(listing, store);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Service");
    expect(ld.name).toBe("Sandbox Analyst");
    expect(ld.url).toBe(`https://store.example.com/listings/${LISTING_A}`);
    const offer = ld.offers as Record<string, unknown>;
    expect(offer["@type"]).toBe("Offer");
    expect(offer.price).toBe("0.001");
    expect(offer.priceCurrency).toBe("SOL");
  });

  it("uses the SPL mint as the currency when priced in a token", () => {
    const ld = listingJsonLd(
      { ...listing, priceMint: "So11111111111111111111111111111111111111112" },
      store,
    );
    const offer = ld.offers as Record<string, unknown>;
    expect(offer.priceCurrency).toBe(
      "So11111111111111111111111111111111111111112",
    );
  });

  it("emits a schema.org Store for the root", () => {
    const ld = storeJsonLd(store);
    expect(ld["@type"]).toBe("Store");
    expect(ld.url).toBe("https://store.example.com");
  });

  // Finding #9 (BLOCKER, revert-sensitive): a malicious listing name must NOT be
  // able to break out of the <script type="application/ld+json"> tag. Bare
  // JSON.stringify leaves `</script>` intact (stored XSS); jsonLdScript escapes
  // `<` so no literal `</script` substring can reach the browser.
  it("jsonLdScript escapes a </script> breakout in untrusted listing data", () => {
    const evil = "</script><script>alert(1)</script>";
    const ld = listingJsonLd({ ...listing, name: evil }, store);
    const out = jsonLdScript(ld);
    // The exact assertion that goes RED against bare JSON.stringify:
    expect(out).not.toContain("</script");
    expect(out).not.toContain("<");
    // Still valid JSON that round-trips back to the original (escaping is lossless).
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed.name).toBe(evil);
  });
});

describe("metadata (OG)", () => {
  it("builds canonical + OG for the store root", () => {
    const meta = storeMetadata(store);
    expect(meta.title).toBe("Acme Agent Store");
    expect(meta.alternates?.canonical).toBe("https://store.example.com");
    expect(meta.openGraph?.images?.[0]?.url).toBe(
      "https://store.example.com/og.png",
    );
    expect(meta.twitter?.card).toBe("summary_large_image");
  });

  it("builds a listing-scoped canonical + title", () => {
    const meta = listingMetadata(listing, store);
    expect(meta.alternates?.canonical).toBe(
      `https://store.example.com/listings/${LISTING_A}`,
    );
    expect(meta.title).toMatch(/Sandbox Analyst/);
  });
});

describe("sitemap + robots", () => {
  it("includes static pages, one entry per listing, one per provider", () => {
    const entries = buildSitemapEntries(store, listings);
    const urls = entries.map((e) => e.url);
    expect(urls).toContain("https://store.example.com/");
    expect(urls).toContain(`https://store.example.com/listings/${LISTING_A}`);
    expect(urls).toContain(`https://store.example.com/listings/${LISTING_B}`);
    expect(urls).toContain(`https://store.example.com/providers/${PROVIDER_A}`);
    // Only ONE provider entry even though two listings share the provider.
    expect(urls.filter((u) => u.includes("/providers/"))).toHaveLength(1);
  });

  it("renders valid-looking sitemap XML", () => {
    const xml = renderSitemapXml(buildSitemapEntries(store, listings));
    expect(xml).toMatch(/^<\?xml/);
    expect(xml).toMatch(/<urlset/);
    expect(xml).toMatch(/<loc>https:\/\/store\.example\.com\//);
  });

  // Finding #12 (minor): the canonical sitemaps namespace is `www.sitemaps.org`
  // (with an 's'); the typo `www.sitemap.org` makes strict validators / Search
  // Console reject the document. Asserts the exact xmlns.
  it("uses the canonical sitemaps.org namespace", () => {
    const xml = renderSitemapXml(buildSitemapEntries(store, listings));
    expect(xml).toContain(
      'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    );
    expect(xml).not.toContain("www.sitemap.org/");
  });

  it("builds robots.txt pointing at the sitemap", () => {
    const robots = buildRobotsTxt(store);
    expect(robots).toMatch(/User-agent: \*/);
    expect(robots).toMatch(/Sitemap: https:\/\/store\.example\.com\/sitemap\.xml/);
  });
});

describe("AgentCard + llms.txt", () => {
  it("emits a machine-readable AgentCard with a hire action", () => {
    const card = listingAgentCard(listing, store);
    expect(card.schema).toBe("agenc.agent-card/v1");
    expect(card.pda).toBe(LISTING_A);
    expect(card.price.sol).toBe("0.001");
    expect(card.price.lamports).toBe("1000000");
    expect(card.action).toEqual({
      type: "hire",
      href: `https://store.example.com/listings/${LISTING_A}`,
    });
  });

  it("emits an llms.txt manifest listing every listing + a trust pointer", () => {
    const txt = buildLlmsTxt(store, listings);
    expect(txt).toMatch(/# Acme Agent Store/);
    expect(txt).toMatch(/Sandbox Analyst/);
    expect(txt).toMatch(/Sandbox Codegen/);
    expect(txt).toMatch(/\/trust/);
  });

  it("renders an empty-but-valid llms.txt when there are no listings", () => {
    const txt = buildLlmsTxt(store, []);
    expect(txt).toMatch(/No listings are currently live/);
  });

  // Finding #13 (minor, revert-sensitive): an untrusted listing name with
  // markdown-link metacharacters must NOT redirect the link or inject extra
  // markdown structure into the agent-actionable /llms.txt manifest.
  it("neutralizes markdown-link metacharacters in an untrusted listing name", () => {
    const evil = "X](http://evil)";
    const txt = buildLlmsTxt(store, [{ ...listing, name: evil }]);
    // The link target must remain the real listing URL, not the injected one:
    expect(txt).not.toContain("](http://evil)");
    // The real canonical listing link is still emitted intact.
    expect(txt).toContain(`/listings/${LISTING_A})`);
    // A newline in the name must not fragment the manifest into a new line.
    const multiline = buildLlmsTxt(store, [
      { ...listing, name: "Y\n## Hacked" },
    ]);
    expect(multiline).not.toMatch(/^## Hacked/m);
  });
});
