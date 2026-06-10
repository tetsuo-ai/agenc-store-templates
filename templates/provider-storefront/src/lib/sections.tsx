/**
 * Client boundary barrel for the store-core section components.
 *
 * WHY THIS FILE EXISTS: `@tetsuo-ai/store-core/sections` and
 * `@tetsuo-ai/marketplace-react` bundle their `"use client"` components into a
 * chunk whose ENTRY file does not re-emit the `"use client"` directive (a tsup
 * bundling artifact). The components call `React.createContext` at module scope,
 * so importing them directly into a Server Component crashes the build with
 * `createContext is not a function`. Re-exporting them through THIS `"use client"`
 * module restores the client boundary, so server pages can render them safely.
 *
 * This is layout/wiring glue, NOT protocol logic (the C1 rule still holds — all
 * hire/protocol behavior lives in store-core + marketplace-react).
 */
"use client";
export {
  StoreShell,
  CatalogSection,
  ListingDetailSection,
  DashboardTaskSection,
  EarningsSection,
  TrustSection,
  SurfaceNotDeployedSection,
  EmptyCatalogSection,
  ZeroMatchSection,
  IndexerUnreachableSection,
} from "@tetsuo-ai/store-core/sections";
