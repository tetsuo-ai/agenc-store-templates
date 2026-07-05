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

  // Moderation attestation is INVISIBLE BY DEFAULT — no setup: attestation
  // (and the P1.2 `moderator` pubkey the hire/activation gates name) is
  // sourced from the marketplace-managed attestation service automatically.
  moderation: {
    // WHOSE moderation records this store consumes at the hire gate — the
    // cross-node trust choice. Either way the on-chain gates stay the
    // enforcement point and BLOCKED verdicts fail closed:
    //  - "edge-list" (the default): only records by this store's OWN attestor
    //    (the marketplace-managed service, or the overrides below). Cross-node
    //    listings stay un-hireable until your attestor re-attests them.
    //  - "any-bonded-attestor": the on-chain attestor roster is the trust
    //    root — a CLEAN record by ANY bonded, non-exiting roster attestor
    //    makes a listing hireable here. Choose this to hire cross-node supply
    //    (listings attested by another marketplace's attestor) without
    //    re-attestation.
    // This explicit value wins over the AGENC_MODERATION_TRUST deploy env.
    trustPolicy: "edge-list",

    // Sovereignty overrides for operators running their OWN attestor:
    // attestorEndpoint: "https://attestor.example.com/api/task-moderation/attest",
    // Only for an OUTDATED self-hosted attestor (< agenc-moderation-api
    // 0.2.1) that doesn't disclose its own signer pubkey:
    // moderator: "YourAttestorSignerPubkey...",
  },

  // PORTABLE STORE IDENTITY (P5.2) — the store serves a signed, domain-neutral
  // `agenc.storeManifest.v1` manifest at `/.well-known/agenc-store.json`, so
  // any surface (agenc.ag, another node, a third-party verifier) can prove YOUR
  // wallet authored exactly this config (fees, moderation posture, agents)
  // without trusting any registry. With nothing set below, the route serves the
  // UNSIGNED manifest (surfaces treat it as unverified, never invalid).
  //
  // To sign it (one signature, no on-chain tx — see
  // node_modules/@tetsuo-ai/store-core/docs/STORE_MANIFEST.md):
  //   1. pin `updatedAt` (the signature covers it),
  //   2. GET /.well-known/agenc-store.json -> copy the `signing.message`,
  //   3. sign that message with your OWNER wallet (any wallet's signMessage, or
  //      `node node_modules/@tetsuo-ai/store-core/scripts/manifest-sign.mjs
  //       <owner-keypair.json> http://localhost:3000/.well-known/agenc-store.json`),
  //   4. paste the base58 signature below. Any later config edit -> re-sign.
  // manifest: {
  //   // wallet: defaults to referrer.wallet (your earning wallet).
  //   // handle: defaults to a slug of `name`.
  //   updatedAt: 1751500000, // unix seconds — pin to the value you signed
  //   signature: "Base58Ed25519SignatureFromStep3...",
  // },
});
