/**
 * Test fixtures: real base58 addresses (from the seeded localnet sandbox) so the
 * config validator's base58 checks exercise genuine addresses, and a full config
 * touching EVERY field for the round-trip test.
 */
import type { StoreConfigInput } from "../src/config/schema.js";

/** A real seeded ServiceListing PDA (base58). */
export const LISTING_A = "7RkbpXC7sPVNYSLVkaxChHgXNa4J8B4kgBhzRZzjTkHc";
/** A second real seeded ServiceListing PDA. */
export const LISTING_B = "2MotDCzC2HR8JstEze45p6ZyJYCzKFuAytGwLVmnopzB";
/** A real seeded provider AgentRegistration PDA. */
export const PROVIDER_A = "H66R3iFjeYj2sweCiFuJXNHz2NhjpFDHKjRNsPznDLC8";
/** A real seeded wallet authority (used as the referrer wallet). */
export const REFERRER_WALLET = "DxY6ZoT2Kgo7ARVMTQ8zVsxQs8yqkNLbuApxc9yf98yX";

/**
 * A config that exercises EVERY field of the schema (the round-trip test asserts
 * each one survives validation + normalization).
 */
export const FULL_CONFIG: StoreConfigInput = {
  name: "Acme Agent Store",
  description: "Hire vetted agents for code review and data work.",
  network: "localnet",
  api: {
    baseUrl: "https://indexer.example.com",
    apiKey: "test-key",
  },
  referrer: {
    wallet: REFERRER_WALLET,
    feeBps: 250,
  },
  branding: {
    logo: "https://example.com/logo.png",
    colors: {
      primary: "#7B3FFF",
      secondary: "#FF2E93",
      background: "#0A0612",
      surface: "#16102A",
      text: "#F5F0FF",
    },
    font: "Inter, sans-serif",
    poweredBy: true,
  },
  curation: {
    categories: ["code-generation", "data-analysis"],
    providers: [PROVIDER_A],
    include: [LISTING_A],
    exclude: [LISTING_B],
    minRating: 3.5,
    requireModeration: true,
  },
  payments: {
    wallets: true,
    embedded: false,
    fiat: false,
    x402: false,
  },
  seo: {
    siteUrl: "https://store.example.com",
    ogImage: "https://store.example.com/og.png",
    llmsTxt: true,
    jsonLd: true,
    sitemap: true,
  },
};

/** The minimal valid config (only the required fields + sensible defaults). */
export const MINIMAL_CONFIG: StoreConfigInput = {
  name: "Minimal Store",
  description: "A minimal store.",
  network: "devnet",
  api: { baseUrl: "https://indexer.example.com" },
  referrer: { wallet: REFERRER_WALLET, feeBps: 0 },
  seo: { siteUrl: "https://minimal.example.com" },
};
