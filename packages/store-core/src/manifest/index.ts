/**
 * `@tetsuo-ai/store-core/manifest` — the reference implementation of the
 * `agenc.storeManifest.v1` portable store identity standard (P5.2 step 1,
 * `agenc-protocol/docs/P5_2_STORE_IDENTITY_SPEC.md` §4/§7.3):
 *
 * - **canonicalize + hash** — `canonicalStoreManifestBytes` /
 *   `storeManifestHashHex` (sorted-key canonical JSON, UTF-8, sha-256);
 * - **the domain-neutral signing envelope** — `storeManifestSigningMessage`
 *   (`agenc store manifest v1\nsha256: <hash>`; NO surface string, so any
 *   surface can issue and verify the proof);
 * - **derive** — `buildStoreManifest` / `storeManifestEnvelopeFromConfig`
 *   from the validated `agenc.config.ts` (fees, moderation posture per Q7);
 * - **sign** — `signStoreManifest` through a signer CALLBACK (never a raw
 *   key);
 * - **verify** — `verifyStoreManifest` (fail-closed, typed errors; unsigned =
 *   unverified, never invalid).
 *
 * Format doc for third-party verifiers: `docs/STORE_MANIFEST.md`.
 *
 * @module manifest
 */
export {
  STORE_MANIFEST_SCHEMA,
  STORE_MANIFEST_WELL_KNOWN_PATH,
  STORE_MANIFEST_HANDLE_RE,
  STORE_MANIFEST_HASH_HEX_RE,
  STORE_MANIFEST_SIGNATURE_RE,
  storeManifestBodySchema,
  storeManifestModerationSchema,
  storeManifestEnvelopeSchema,
  storeManifestSigningHintSchema,
  assertStoreManifestBody,
  StoreManifestError,
  type StoreManifestBody,
  type StoreManifestModeration,
  type StoreManifestEnvelope,
  type StoreManifestSigningHint,
  type SignedStoreManifest,
  type UnsignedStoreManifest,
  type StoreManifestErrorCode,
} from "./schema.js";

export {
  STORE_MANIFEST_SIGNING_PREFIX,
  canonicalStoreManifestJson,
  canonicalStoreManifestBytes,
  storeManifestHashHex,
  storeManifestSigningMessage,
  storeManifestSigningBytes,
} from "./canonical.js";

export {
  buildStoreManifest,
  storeManifestEnvelopeFromConfig,
  deriveStoreManifestHandle,
  type BuildStoreManifestOptions,
} from "./build.js";

export { signStoreManifest, type StoreManifestSigner } from "./sign.js";

export {
  verifyStoreManifest,
  type VerifyStoreManifestOptions,
  type StoreManifestVerification,
} from "./verify.js";
