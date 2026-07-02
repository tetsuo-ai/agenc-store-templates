/**
 * `@tetsuo-ai/store-core/activation` — the client-safe half of the
 * hire→activation seam (WP-B1): the store job-spec shape/builders and the
 * `hostAndModerateJobSpec` client for `useHumanlessHireFlow`.
 *
 * The server half (the activation route handler, job-spec hosting stores, and
 * the attestor resolvers) lives at `@tetsuo-ai/store-core/activation/server` —
 * it imports node builtins and must never enter a client bundle.
 *
 * @module activation
 */
export {
  STORE_JOB_SPEC_SCHEMA,
  JOB_SPEC_LIMITS,
  buildListingJobSpec,
  normalizeStoreJobSpec,
  type StoreJobSpecDraft,
  type StoreJobSpecPayload,
} from "./job-spec.js";

export {
  DEFAULT_ACTIVATION_ROUTE,
  createStoreActivationHost,
  type StoreActivationHostInput,
  type StoreActivationHostResult,
  type StoreActivationHostOptions,
} from "./client.js";

export { bytesToHex, hexToBytes, HASH_HEX_RE } from "./hex.js";
