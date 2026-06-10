/**
 * Config surface tests (PLAN_2 C2 Done-when):
 * - a round-trip test covering EVERY field;
 * - the three MANDATED failure fixtures (invalid-wallet, over-cap feeBps,
 *   un-overridden mainnet) each fail with the RIGHT message;
 * - the reserved-payment + defaulting behavior.
 */
import { describe, it, expect } from "vitest";
import {
  defineStore,
  safeDefineStore,
  StoreConfigError,
  REFERRER_COMBINED_FEE_BPS_CAP,
} from "../src/config/index.js";
import {
  FULL_CONFIG,
  MINIMAL_CONFIG,
  REFERRER_WALLET,
  PROVIDER_A,
  LISTING_A,
  LISTING_B,
} from "./fixtures.js";

describe("defineStore — round-trip (every field)", () => {
  const config = defineStore(FULL_CONFIG);

  it("preserves the top-level identity + network fields", () => {
    expect(config.name).toBe("Acme Agent Store");
    expect(config.description).toBe(
      "Hire vetted agents for code review and data work.",
    );
    expect(config.network).toBe("localnet");
  });

  it("preserves the api block", () => {
    expect(config.api.baseUrl).toBe("https://indexer.example.com");
    expect(config.api.apiKey).toBe("test-key");
  });

  it("preserves the referrer block (validated wallet + fee)", () => {
    expect(config.referrer.wallet).toBe(REFERRER_WALLET);
    expect(config.referrer.feeBps).toBe(250);
  });

  it("preserves the branding block including every color token", () => {
    expect(config.branding.logo).toBe("https://example.com/logo.png");
    expect(config.branding.font).toBe("Inter, sans-serif");
    expect(config.branding.poweredBy).toBe(true);
    expect(config.branding.colors).toEqual({
      primary: "#7B3FFF",
      secondary: "#FF2E93",
      background: "#0A0612",
      surface: "#16102A",
      text: "#F5F0FF",
    });
  });

  it("preserves the curation block (categories, providers, include/exclude, minRating)", () => {
    expect(config.curation.categories).toEqual([
      "code-generation",
      "data-analysis",
    ]);
    expect(config.curation.providers).toEqual([PROVIDER_A]);
    expect(config.curation.include).toEqual([LISTING_A]);
    expect(config.curation.exclude).toEqual([LISTING_B]);
    expect(config.curation.minRating).toBe(3.5);
    expect(config.curation.requireModeration).toBe(true);
  });

  it("preserves the payments block", () => {
    expect(config.payments.wallets).toBe(true);
    expect(config.payments.embedded).toBe(false);
    expect(config.payments.fiat).toBe(false);
    expect(config.payments.x402).toBe(false);
  });

  it("preserves the seo block", () => {
    expect(config.seo.siteUrl).toBe("https://store.example.com");
    expect(config.seo.ogImage).toBe("https://store.example.com/og.png");
    expect(config.seo.llmsTxt).toBe(true);
    expect(config.seo.jsonLd).toBe(true);
    expect(config.seo.sitemap).toBe(true);
  });
});

describe("defineStore — defaults applied to a minimal config", () => {
  const config = defineStore(MINIMAL_CONFIG);

  it("defaults requireModeration ON (fail-closed)", () => {
    expect(config.curation.requireModeration).toBe(true);
  });

  it("defaults the poweredBy footer ON (referral disclosure)", () => {
    expect(config.branding.poweredBy).toBe(true);
  });

  it("defaults wallets payment ON", () => {
    expect(config.payments.wallets).toBe(true);
  });

  it("defaults the SEO emitters ON", () => {
    expect(config.seo.llmsTxt).toBe(true);
    expect(config.seo.jsonLd).toBe(true);
    expect(config.seo.sitemap).toBe(true);
  });
});

describe("defineStore — MANDATED failure fixtures", () => {
  it("rejects an invalid (non-base58) referrer wallet so fees never silently drop", () => {
    expect(() =>
      defineStore({
        ...MINIMAL_CONFIG,
        referrer: { wallet: "not-a-real-wallet!!!", feeBps: 100 },
      }),
    ).toThrow(StoreConfigError);

    const result = safeDefineStore({
      ...MINIMAL_CONFIG,
      referrer: { wallet: "not-a-real-wallet!!!", feeBps: 100 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const walletIssue = result.error.issues.find(
        (issue) => issue.path.join(".") === "referrer.wallet",
      );
      expect(walletIssue).toBeDefined();
      expect(walletIssue?.message).toMatch(/base58/i);
      // The full message is actionable and names the field.
      expect(result.error.message).toMatch(/referrer\.wallet/);
    }
  });

  it("rejects an over-cap referrer feeBps (> combined cap)", () => {
    const overCap = REFERRER_COMBINED_FEE_BPS_CAP + 1;
    const result = safeDefineStore({
      ...MINIMAL_CONFIG,
      referrer: { wallet: REFERRER_WALLET, feeBps: overCap },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const feeIssue = result.error.issues.find(
        (issue) => issue.path.join(".") === "referrer.feeBps",
      );
      expect(feeIssue).toBeDefined();
      expect(feeIssue?.message).toMatch(
        new RegExp(String(REFERRER_COMBINED_FEE_BPS_CAP)),
      );
      expect(feeIssue?.message).toMatch(/cap/i);
    }
  });

  it("rejects un-overridden mainnet (Phase 9 gate) with an actionable message", () => {
    const result = safeDefineStore({
      ...MINIMAL_CONFIG,
      network: "mainnet",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const networkIssue = result.error.issues.find(
        (issue) => issue.path.join(".") === "network",
      );
      expect(networkIssue).toBeDefined();
      expect(networkIssue?.message).toMatch(/Phase 9/);
      expect(networkIssue?.message).toMatch(/allowMainnet/);
    }
  });

  it("ACCEPTS mainnet WITH the explicit allowMainnet override", () => {
    const config = defineStore({
      ...MINIMAL_CONFIG,
      network: "mainnet",
      allowMainnet: true,
    });
    expect(config.network).toBe("mainnet");
    expect(config.allowMainnet).toBe(true);
  });
});

describe("defineStore — reserved payment paths fail closed", () => {
  it("rejects payments.embedded = true (vendor not wired)", () => {
    const result = safeDefineStore({
      ...MINIMAL_CONFIG,
      payments: { wallets: true, embedded: true },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.join(".") === "payments.embedded"),
      ).toBe(true);
    }
  });

  it("rejects payments.fiat = true and payments.x402 = true", () => {
    const fiat = safeDefineStore({
      ...MINIMAL_CONFIG,
      payments: { wallets: true, fiat: true },
    });
    const x402 = safeDefineStore({
      ...MINIMAL_CONFIG,
      payments: { wallets: true, x402: true },
    });
    expect(fiat.success).toBe(false);
    expect(x402.success).toBe(false);
  });
});

describe("defineStore — error formatting", () => {
  it("lists every issue with its field path in one actionable message", () => {
    const result = safeDefineStore({
      name: "",
      description: "",
      network: "mainnet",
      api: { baseUrl: "not-a-url" },
      referrer: { wallet: "bad", feeBps: 99999 },
      seo: { siteUrl: "also-not-a-url" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.message;
      expect(msg).toMatch(/Invalid AgenC store config/);
      // Multiple distinct field paths surface.
      expect(msg).toMatch(/referrer\.wallet/);
      expect(msg).toMatch(/api\.baseUrl/);
      expect(msg).toMatch(/seo\.siteUrl/);
      expect(result.error.issues.length).toBeGreaterThan(3);
    }
  });
});
