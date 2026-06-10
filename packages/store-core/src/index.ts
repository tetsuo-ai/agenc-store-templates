/**
 * `@tetsuo-ai/store-core` — the shared package every AgenC store template
 * consumes (PLAN_2 Part C). ALL protocol/hire logic lives here and in
 * `@tetsuo-ai/marketplace-react`; template code is layout + config ONLY (the C1
 * architecture rule).
 *
 * Public surface, by area:
 * - **config** — `defineStore()` + the zod `StoreConfig` schema, the surface
 *   check (`getDeployedSurface` / `SurfaceNotDeployedError`), curation, and the
 *   per-listing combined-fee pre-check.
 * - **seo** — JSON-LD, OG/meta, sitemap/robots, llms.txt, per-listing AgentCard.
 * - **sections** — the shared page components that wrap `marketplace-react`.
 * - **upgrade** — the C7 staleness check, changelog feed hook, `<UpdateBanner>`.
 *
 * Each area is also tree-shakeable via its subpath export
 * (`@tetsuo-ai/store-core/config`, `/seo`, `/sections`, `/upgrade`).
 *
 * The P6.2 referrer gate is preserved end-to-end: referrer config is validated +
 * stored + disclosed, NEVER injected, NEVER fabricated as earnings.
 *
 * @packageDocumentation
 */

export * from "./config/index.js";
export * from "./seo/index.js";
export * from "./sections/index.js";
export * from "./upgrade/index.js";
