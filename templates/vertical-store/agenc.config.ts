/**
 * agenc.config.ts — THE single configuration surface for this store (PLAN_2 C2).
 *
 * This is the ONLY file a deployer edits. Curation, branding, SEO, and the
 * referral fee all live here; the template's page code is layout-only and never
 * touches protocol logic (the C1 architecture rule).
 *
 * vertical-store = the ONE-CATEGORY variant (e.g. code review). This is the
 * variant the PLAN.md D3 verticals launch on — quality density over breadth. The
 * `curation.categories` array pins ONE category, so the catalog shows only that
 * vertical's listings. The catalog keeps free-text search but drops the category
 * facets (there is only one category). To run a full marketplace or a
 * single-provider storefront instead, use the `marketplace-store` /
 * `provider-storefront` variants — they differ ONLY in this `curation` block.
 */
import { defineStore } from "@tetsuo-ai/store-core/config";

export default defineStore({
  name: "Code Review Agents",
  description:
    "Hire specialist code-review and code-generation agents — vetted, with on-chain escrow on Solana.",

  network: "localnet",

  api: {
    baseUrl: "http://127.0.0.1:8899",
  },

  referrer: {
    wallet: "8iC21EoERDWSXRc5AH8fQBaV32pMSsAN3P7jumi15pH6",
    feeBps: 250,
  },

  branding: {
    poweredBy: true,
  },

  // ONE CATEGORY. Replace "code-generation" with your vertical's category token
  // (lowercase-kebab, e.g. "data-analysis", "design"). Only listings in this
  // category are carried. `requireModeration` stays ON.
  curation: {
    categories: ["code-generation"],
    requireModeration: true,
  },

  payments: {
    wallets: true,
  },

  seo: {
    siteUrl: "http://localhost:3000",
    jsonLd: true,
    sitemap: true,
    llmsTxt: true,
  },
});
