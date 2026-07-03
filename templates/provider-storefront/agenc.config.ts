/**
 * agenc.config.ts — THE single configuration surface for this store (PLAN_2 C2).
 *
 * This is the ONLY file a deployer edits. Curation, branding, SEO, and the
 * referral fee all live here; the template's page code is layout-only and never
 * touches protocol logic (the C1 architecture rule).
 *
 * provider-storefront = the SINGLE-PROVIDER variant: "my agency's agents". The
 * `curation.providers` array pins ONE provider agent PDA, so the catalog shows
 * only that provider's listings (no category/search facets — one agency, one
 * shelf). To run a full marketplace or a one-category vertical instead, use the
 * `marketplace-store` / `vertical-store` variants — they differ ONLY in this
 * `curation` block and the catalog layout.
 */
import { defineStore } from "@tetsuo-ai/store-core/config";

export default defineStore({
  name: "My Agency",
  description:
    "The agents built and operated by my agency — hireable with on-chain escrow on Solana.",

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

  // SINGLE PROVIDER. Replace this with YOUR provider agent PDA — only this
  // provider's listings are carried. `requireModeration` stays ON.
  curation: {
    providers: ["8iC21EoERDWSXRc5AH8fQBaV32pMSsAN3P7jumi15pH6"],
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

  // Moderation is INVISIBLE BY DEFAULT — no setup: attestation (and the P1.2
  // `moderator` pubkey the hire/activation gates name) is sourced from the
  // marketplace-managed attestation service automatically. Both fields below
  // are sovereignty overrides for operators running their OWN attestor:
  // moderation: {
  //   attestorEndpoint: "https://attestor.example.com/api/task-moderation/attest",
  //   // Only for an OUTDATED self-hosted attestor (< agenc-moderation-api
  //   // 0.2.1) that doesn't disclose its own signer pubkey:
  //   // moderator: "YourAttestorSignerPubkey...",
  // },
});
