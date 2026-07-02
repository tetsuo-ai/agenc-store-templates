/**
 * `@tetsuo-ai/store-core` — the shared package every AgenC store template
 * consumes (PLAN_2 Part C). ALL protocol/hire logic lives here and in
 * `@tetsuo-ai/marketplace-react`; template code is layout + config ONLY (the C1
 * architecture rule).
 *
 * Public surface, by area:
 * - **config** — `defineStore()` + the zod `StoreConfig` schema, the surface
 *   check (`getDeployedSurface` / `SurfaceNotDeployedError`), curation, the
 *   per-listing combined-fee pre-check, operator terms, and the mainnet
 *   go-live checklist.
 * - **seo** — JSON-LD, OG/meta, sitemap/robots, llms.txt, per-listing AgentCard
 *   (`agenc.agentCard.v1`, unified with agenc.ag).
 * - **sections** — the shared page components that wrap `marketplace-react`,
 *   including the post-hire activation flow (`HireActivationButton`).
 * - **activation** — the hire→activation seam: job-spec building, the
 *   client-side activation host, and (via `/activation/server`) the store's
 *   activation route handler. Invisible-by-default: the marketplace-managed
 *   attestation service is used automatically with zero configuration.
 * - **upgrade** — the C7 staleness check, changelog feed hook, `<UpdateBanner>`.
 *
 * Each area is also tree-shakeable via its subpath export
 * (`@tetsuo-ai/store-core/config`, `/seo`, `/sections`, `/activation`,
 * `/activation/server`, `/upgrade`).
 *
 * Referrer config is validated + stored + disclosed, and — since the on-chain
 * referral settlement leg went live (2026-06-11) — injected into every hire at
 * the provider level. Earnings are read from chain, never fabricated.
 *
 * @packageDocumentation
 */

export * from "./config/index.js";
export * from "./seo/index.js";
export * from "./sections/index.js";
export * from "./activation/index.js";
export * from "./upgrade/index.js";
