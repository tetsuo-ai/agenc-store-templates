/**
 * `@tetsuo-ai/store-core/config` — the single configuration surface (PLAN_2 C2).
 *
 * Exports `defineStore()`, the zod {@link StoreConfig} schema + every field
 * type, the surface-deployment check, the curation logic, and the per-listing
 * combined-fee pre-check.
 *
 * @module config
 */
export {
  defineStore,
  safeDefineStore,
  StoreConfigError,
} from "./define-store.js";

export {
  storeConfigSchema,
  storeConfigObjectSchema,
  storeNetworkSchema,
  referrerSchema,
  brandingSchema,
  brandingColorsSchema,
  curationSchema,
  paymentsSchema,
  seoSchema,
  apiSchema,
  moderationSchema,
  operatorSchema,
  listingCategorySchema,
  REFERRER_COMBINED_FEE_BPS_CAP,
  REFERRER_FEE_BPS_MIN,
  REFERRER_FEE_BPS_MAX,
  type StoreConfig,
  type StoreConfigInput,
  type StoreNetwork,
  type ReferrerConfig,
  type Branding,
  type BrandingColors,
  type Curation,
  type Payments,
  type Seo,
  type ApiConfig,
  type ModerationConfig,
  type OperatorConfig,
  type ListingCategory,
} from "./schema.js";

export {
  getDeployedSurface,
  SurfaceNotDeployedError,
  type DeployedSurface,
  type SurfaceNotDeployedReason,
  type SurfaceProbe,
} from "./surface.js";

export {
  checkCombinedFee,
  type CombinedFeeInput,
  type CombinedFeeResult,
} from "./referrer-fee.js";

export {
  applyCuration,
  curationToListingsFilter,
  curationIsActive,
  type CurateableListing,
  type CurationListingsFilter,
} from "./curation.js";

export {
  listingOperatorTerms,
  type ListingOperatorTerms,
} from "./operator.js";

export {
  checkMainnetGoLive,
  detectEphemeralHosting,
  type GoLiveCheck,
  type GoLiveEnv,
  type GoLiveResult,
} from "./go-live.js";
