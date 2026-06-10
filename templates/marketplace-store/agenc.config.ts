/**
 * agenc.config.ts — THE single configuration surface for this store (PLAN_2 C2).
 *
 * This is the ONLY file a deployer edits. Curation, branding, SEO, and the
 * referral fee all live here; the template's page code is layout-only and never
 * touches protocol logic (the C1 architecture rule that makes an instance update
 * a dependency bump + redeploy, never a template-code merge — PLAN_2 C7).
 *
 * `defineStore` validates this at build time and FAILS the build with an
 * actionable message on any misconfiguration (a wrong referrer wallet would
 * silently drop the owner's fees, so it is a hard error).
 *
 * marketplace-store = the FULL catalog variant: no provider/category narrowing,
 * so every Active + moderated listing in the book is rendered (grid + category
 * filters + search). To launch a single-provider storefront or a one-category
 * vertical, use the `provider-storefront` / `vertical-store` variants instead —
 * they differ ONLY in this file's `curation` block.
 */
import { defineStore } from "@tetsuo-ai/store-core/config";

export default defineStore({
  name: "Acme Agent Store",
  description:
    "Hire vetted AI agents for any task — code, data, design, and more — with on-chain escrow on Solana.",

  // localnet (the local sandbox) by default for the local-first build flow.
  // Switch to "devnet" to deploy a public devnet store. "mainnet" is gated
  // until Phase 9 and additionally requires `allowMainnet: true`.
  network: "localnet",

  // The hosted indexer/storefront API (PLAN.md P3.2). For localnet the template
  // falls back to the local RPC gPA path automatically when this is unreachable.
  api: {
    baseUrl: "http://127.0.0.1:8899",
    // apiKey: process.env.AGENC_API_KEY,
  },

  // EVERY hire pays the store owner this referral fee — once the P6.2 settlement
  // leg is live on-chain (it is not yet). Until then the fee is validated,
  // stored, and DISCLOSED on /trust + checkout, but NEVER injected or fabricated.
  // Replace this with YOUR wallet to earn.
  referrer: {
    wallet: "8iC21EoERDWSXRc5AH8fQBaV32pMSsAN3P7jumi15pH6",
    feeBps: 250, // 2.5% — shares the protocol+operator+referrer <= 4000 bps cap
  },

  branding: {
    // logo: "/logo.svg",
    poweredBy: true, // doubles as the standing referral disclosure
    // colors: { primary: "#7C3AED", background: "#0A0612" },
  },

  // Full catalog: no provider/category narrowing. `requireModeration` stays ON
  // (fail-closed) — unattested listings are gated by default.
  curation: {
    requireModeration: true,
  },

  payments: {
    wallets: true, // Wallet Standard connect-and-sign (P4.1)
    // embedded / fiat / x402 are reserved; enabling one before its backend
    // ships fails the build (so a store never advertises a checkout it can't
    // complete).
  },

  seo: {
    siteUrl: "http://localhost:3000",
    // ogImage: "/og.png",
    jsonLd: true,
    sitemap: true,
    llmsTxt: true,
  },
});
