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
  listingOperatorTerms,
  checkMainnetGoLive,
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

  it("rejects un-overridden mainnet (real-funds opt-in gate) with an actionable message", () => {
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
      // The copy is off the retired "Phase 9" framing: it names the real-funds
      // stake, the exact override, and the go-live checklist.
      expect(networkIssue?.message).not.toMatch(/Phase 9/);
      expect(networkIssue?.message).toMatch(/REAL funds/i);
      expect(networkIssue?.message).toMatch(/allowMainnet/);
      expect(networkIssue?.message).toMatch(/GO_LIVE/);
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

describe("defineStore — moderation (sovereignty override only)", () => {
  it("validates with NO moderation config at all (invisible-by-default)", () => {
    const config = defineStore(MINIMAL_CONFIG);
    expect(config.moderation).toBeUndefined();
  });

  it("accepts the optional attestorEndpoint sovereignty override", () => {
    const config = defineStore({
      ...MINIMAL_CONFIG,
      moderation: { attestorEndpoint: "https://attestor.example.com/attest" },
    });
    expect(config.moderation?.attestorEndpoint).toBe(
      "https://attestor.example.com/attest",
    );
  });

  it("rejects a non-URL attestorEndpoint", () => {
    const result = safeDefineStore({
      ...MINIMAL_CONFIG,
      moderation: { attestorEndpoint: "not-a-url" },
    });
    expect(result.success).toBe(false);
  });
});

describe("defineStore — operator terms on listing creation", () => {
  it("accepts an operator block and maps it to createServiceListing args", () => {
    const config = defineStore({
      ...MINIMAL_CONFIG,
      operator: { wallet: REFERRER_WALLET, feeBps: 1000 },
    });
    expect(listingOperatorTerms(config)).toEqual({
      operator: REFERRER_WALLET,
      operatorFeeBps: 1000,
    });
  });

  it("maps an absent operator block to the documented no-leg encoding", () => {
    const config = defineStore(MINIMAL_CONFIG);
    expect(listingOperatorTerms(config)).toEqual({
      operator: null,
      operatorFeeBps: 0,
    });
  });

  it("rejects a non-base58 operator wallet and an over-cap fee", () => {
    expect(
      safeDefineStore({
        ...MINIMAL_CONFIG,
        operator: { wallet: "nope!!", feeBps: 100 },
      }).success,
    ).toBe(false);
    expect(
      safeDefineStore({
        ...MINIMAL_CONFIG,
        operator: {
          wallet: REFERRER_WALLET,
          feeBps: REFERRER_COMBINED_FEE_BPS_CAP + 1,
        },
      }).success,
    ).toBe(false);
  });
});

describe("checkMainnetGoLive — the real-funds checklist behind allowMainnet", () => {
  const mainnetInput = {
    ...MINIMAL_CONFIG,
    network: "mainnet" as const,
    allowMainnet: true,
  };

  it("passes for a production-shaped config (and needs NO moderation setup)", () => {
    const config = defineStore({
      ...mainnetInput,
      api: { baseUrl: "https://indexer.example.com" },
      seo: { siteUrl: "https://store.example.com" },
    });
    const result = checkMainnetGoLive(config, {});
    expect(result.ready).toBe(true);
    // Invisible-by-default: no check may mention moderation setup.
    for (const c of result.checks) {
      expect(c.id).not.toMatch(/moderation|attest/i);
    }
  });

  it("fails a localhost read path unless AGENC_RPC_URL overrides it", () => {
    const config = defineStore({
      ...mainnetInput,
      api: { baseUrl: "http://127.0.0.1:8899" },
      seo: { siteUrl: "https://store.example.com" },
    });
    const bad = checkMainnetGoLive(config, {});
    expect(bad.ready).toBe(false);
    expect(bad.checks.find((c) => c.id === "read-path")?.ok).toBe(false);

    const good = checkMainnetGoLive(config, {
      AGENC_RPC_URL: "https://rpc.example.com",
    });
    expect(good.checks.find((c) => c.id === "read-path")?.ok).toBe(true);
  });

  it("fails a localhost siteUrl (job-spec pointers derive from it)", () => {
    const config = defineStore({
      ...mainnetInput,
      api: { baseUrl: "https://indexer.example.com" },
      seo: { siteUrl: "http://localhost:3000" },
    });
    const result = checkMainnetGoLive(config, {});
    expect(result.ready).toBe(false);
    expect(result.checks.find((c) => c.id === "site-url")?.ok).toBe(false);
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
