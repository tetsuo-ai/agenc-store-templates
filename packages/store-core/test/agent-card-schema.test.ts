/**
 * WP-F4 guards: the vendored `agenc.agentCard.v1` JSON Schema document + the
 * legacy-id read path.
 *
 * The card shape is defined ONCE — the JSON Schema served by agenc.ag at
 * https://agenc.ag/schemas/agenc.agentCard.v1.json — and vendored
 * byte-identically here (schemas/agenc.agentCard.v1.json) because the two
 * repos cannot share a package yet. The byte-equality test below is the
 * drift guard for that mechanism: any hand-edit of the vendored copy (or a
 * re-vendor that diverges from the committed fixture) fails loudly, and the
 * fixture is only updated together with a re-vendor from agenc.ag.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  AGENT_CARD_LEGACY_SCHEMA,
  AGENT_CARD_SCHEMA,
  AGENT_CARD_SCHEMA_URL,
  listingAgentCard,
  parseAgentCard,
  type SeoListing,
  type SeoStoreContext,
} from "../src/seo/index.js";
import { LISTING_A, PROVIDER_A } from "./fixtures.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VENDORED = resolve(ROOT, "schemas/agenc.agentCard.v1.json");
const FIXTURE = resolve(ROOT, "test/fixtures/agenc.agentCard.v1.json");

const store: SeoStoreContext = {
  name: "Acme Agent Store",
  description: "Hire vetted agents.",
  siteUrl: "https://store.example.com",
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
  provider: PROVIDER_A,
};

describe("vendored agenc.agentCard.v1 JSON Schema", () => {
  it("is byte-identical to the committed fixture (re-vendor drift guard)", () => {
    expect(readFileSync(VENDORED, "utf8")).toBe(readFileSync(FIXTURE, "utf8"));
  });

  it("uses the reproducible stringify formatting agenc.ag serves verbatim", () => {
    const bytes = readFileSync(VENDORED, "utf8");
    expect(bytes).toBe(`${JSON.stringify(JSON.parse(bytes), null, 2)}\n`);
  });

  it("identifies the unified schema (id, $id, legacy alias documented)", () => {
    const schema = JSON.parse(readFileSync(VENDORED, "utf8"));
    expect(schema.$id).toBe(AGENT_CARD_SCHEMA_URL);
    expect(schema.properties.schema.const).toBe(AGENT_CARD_SCHEMA);
    expect(schema["x-deprecated-aliases"][AGENT_CARD_LEGACY_SCHEMA]).toBeTruthy();
  });

  it("validates the emitted card: every required key present, no extras", () => {
    const schema = JSON.parse(readFileSync(VENDORED, "utf8"));
    const card = listingAgentCard(listing, store, { referrerFeeBps: 250 });
    const emitted = Object.keys(card).sort();
    expect(emitted).toEqual([...(schema.required as string[])].sort());
    // Spot-validate the schema's structural constraints against the card.
    expect(card.schema).toBe(schema.properties.schema.const);
    expect(card.id).toMatch(new RegExp(schema.properties.id.pattern));
    expect(Array.isArray(card.tags)).toBe(true);
    expect(typeof card.hireability.hireable).toBe("boolean");
  });
});

describe("parseAgentCard (WP-F4 read path)", () => {
  it("round-trips the unified card", () => {
    const card = listingAgentCard(listing, store, { referrerFeeBps: 250 });
    const parsed = parseAgentCard(JSON.parse(JSON.stringify(card)));
    expect(parsed).toEqual(card);
    expect(parsed?.schema).toBe(AGENT_CARD_SCHEMA);
  });

  it("accepts the DEPRECATED agenc.agent-card/v1 shape and up-converts it", () => {
    // The exact pre-WP-B1 emitter output (see git history fa917a9).
    const legacy = {
      schema: AGENT_CARD_LEGACY_SCHEMA,
      pda: LISTING_A,
      name: "Sandbox Analyst",
      category: "data-analysis",
      tags: ["sql", "charts"],
      description: "Turns raw CSVs into a report.",
      price: { sol: "0.001", lamports: "1000000", mint: null },
      provider: PROVIDER_A,
      url: `https://store.example.com/listings/${LISTING_A}`,
      action: { type: "hire", href: `https://store.example.com/listings/${LISTING_A}` },
    };
    const parsed = parseAgentCard(legacy);
    expect(parsed).not.toBeNull();
    // The parsed card ALWAYS carries the unified id — re-emitting a parsed
    // card can never resurrect the legacy id.
    expect(parsed?.schema).toBe(AGENT_CARD_SCHEMA);
    expect(parsed?.id).toBe(LISTING_A);
    expect(parsed?.name).toBe("Sandbox Analyst");
    expect(parsed?.price).toEqual({ amount: "0.001", currency: "SOL" });
    expect(parsed?.providerAgent).toBe(PROVIDER_A);
    expect(parsed?.metadataState).toBe("unverified");
    expect(parsed?.store).toBeNull();
  });

  it("up-converts legacy SPL pricing", () => {
    const parsed = parseAgentCard({
      schema: AGENT_CARD_LEGACY_SCHEMA,
      pda: LISTING_A,
      name: "Tokenized",
      price: { sol: "0", lamports: "42", mint: PROVIDER_A },
      url: `https://store.example.com/listings/${LISTING_A}`,
      action: { type: "hire", href: "x" },
    });
    expect(parsed?.price).toEqual({
      amountRaw: "42",
      currency: "SPL_TOKEN",
      mint: PROVIDER_A,
    });
  });

  it("rejects unknown ids and structurally broken cards", () => {
    expect(parseAgentCard(null)).toBeNull();
    expect(parseAgentCard("nope")).toBeNull();
    expect(parseAgentCard({ schema: "agenc.agentCard.v2" })).toBeNull();
    // Unified id with a legacy body must not pass.
    expect(
      parseAgentCard({
        schema: AGENT_CARD_SCHEMA,
        pda: LISTING_A,
        name: "x",
        price: { sol: "0.001", lamports: "1000000", mint: null },
        url: "https://x",
        action: { type: "hire", href: "https://x" },
      }),
    ).toBeNull();
    // Legacy id with a broken price must not pass.
    expect(
      parseAgentCard({
        schema: AGENT_CARD_LEGACY_SCHEMA,
        pda: LISTING_A,
        name: "x",
        price: { sol: 1 },
        url: "https://x",
      }),
    ).toBeNull();
  });
});
