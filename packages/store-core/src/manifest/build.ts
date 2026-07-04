/**
 * Derive the `agenc.storeManifest.v1` body + served envelope from a validated
 * `StoreConfig` (the templates' `agenc.config.ts`). This is the ONE mapping
 * from the config surface to the signed identity document (spec §4):
 *
 * | manifest field    | config source                                        |
 * | ----------------- | ---------------------------------------------------- |
 * | `wallet`          | `manifest.wallet` ?? `referrer.wallet` (the owner)   |
 * | `handle`          | `manifest.handle` ?? slug of `name`                  |
 * | `title`           | `name`                                               |
 * | `origin`          | origin of `seo.siteUrl`                              |
 * | `referrerFeeBps`  | `referrer.feeBps`                                    |
 * | `operator`(+bps)  | `operator.wallet`/`feeBps` (`""`/`0` when unset)     |
 * | `moderation`      | `moderation.attestorEndpoint`/`moderator` (Q7)       |
 * | `agents`          | `manifest.agents` ?? `curation.providers` ?? `[]`    |
 * | `storePda`        | `manifest.storePda` (Architecture A, when it ships)  |
 * | `updatedAt`       | `manifest.updatedAt` (pinned when signed) ?? now     |
 *
 * @module manifest/build
 */
import type { StoreConfig } from "../config/schema.js";
import { storeManifestHashHex, storeManifestSigningMessage } from "./canonical.js";
import {
  assertStoreManifestBody,
  STORE_MANIFEST_HANDLE_RE,
  STORE_MANIFEST_SCHEMA,
  StoreManifestError,
  type StoreManifestBody,
  type StoreManifestEnvelope,
  type UnsignedStoreManifest,
} from "./schema.js";
import { verifyStoreManifest } from "./verify.js";

/** Per-call overrides for {@link buildStoreManifest} (each defaults from the config). */
export interface BuildStoreManifestOptions {
  /** Owner wallet override (default `config.manifest.wallet` ?? `config.referrer.wallet`). */
  wallet?: string;
  /** Handle override (default `config.manifest.handle` ?? a slug of `config.name`). */
  handle?: string;
  /** Origin override (default: the origin of `config.seo.siteUrl`). */
  origin?: string;
  /** Agents override (default `config.manifest.agents` ?? `config.curation.providers` ?? `[]`). */
  agents?: string[];
  /** Store PDA override (default `config.manifest.storePda`). */
  storePda?: string;
  /** `updatedAt` override, unix seconds (default `config.manifest.updatedAt` ?? now). */
  updatedAt?: number;
}

/**
 * Slugify a store name into a manifest handle — the same lower/kebab
 * discipline as the AgentCard store handle, clamped to the 3-20 charset
 * ({@link STORE_MANIFEST_HANDLE_RE}).
 *
 * @param name - The store display name.
 * @returns The derived handle.
 * @throws StoreManifestError when no valid handle can be derived (set
 *   `manifest.handle` in `agenc.config.ts` instead).
 */
export function deriveStoreManifestHandle(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20)
    .replace(/-+$/g, "");
  if (!STORE_MANIFEST_HANDLE_RE.test(slug)) {
    throw new StoreManifestError(
      "MANIFEST_MALFORMED",
      `cannot derive a manifest handle from the store name ${JSON.stringify(name)} ` +
        "(needs 3-20 lowercase [a-z0-9-] chars, starting alphanumeric) — set " +
        "manifest.handle in agenc.config.ts",
    );
  }
  return slug;
}

/**
 * Build the canonical manifest BODY from a validated store config. Pure and
 * deterministic given `updatedAt` — the exact same config always produces the
 * exact same signable bytes.
 *
 * @param config - The validated `StoreConfig` (output of `defineStore`).
 * @param options - Per-call overrides ({@link BuildStoreManifestOptions}).
 * @returns The validated {@link StoreManifestBody}.
 */
export function buildStoreManifest(
  config: StoreConfig,
  options: BuildStoreManifestOptions = {},
): StoreManifestBody {
  const pinned = config.manifest;
  const moderation = config.moderation;
  const moderationPosture =
    moderation &&
    (moderation.attestorEndpoint !== undefined ||
      moderation.moderator !== undefined)
      ? {
          ...(moderation.attestorEndpoint !== undefined
            ? { attestorEndpoint: moderation.attestorEndpoint }
            : {}),
          ...(moderation.moderator !== undefined
            ? { moderator: moderation.moderator }
            : {}),
        }
      : undefined;
  const storePda = options.storePda ?? pinned?.storePda;

  // Assemble as a plain record and let assertStoreManifestBody produce the
  // validated, typed result — the config's `base58Address` fields are branded
  // `Address`, so a direct `StoreManifestBody` literal would fight the brands
  // for no benefit (validation re-checks every field regardless).
  const body: Record<string, unknown> = {
    agents: options.agents ?? pinned?.agents ?? config.curation.providers ?? [],
    handle:
      options.handle ?? pinned?.handle ?? deriveStoreManifestHandle(config.name),
    ...(moderationPosture !== undefined ? { moderation: moderationPosture } : {}),
    operator: config.operator?.wallet ?? "",
    operatorFeeBps: config.operator?.feeBps ?? 0,
    origin: options.origin ?? new URL(config.seo.siteUrl).origin,
    referrerFeeBps: config.referrer.feeBps,
    schema: STORE_MANIFEST_SCHEMA,
    ...(storePda !== undefined ? { storePda } : {}),
    title: config.name,
    updatedAt:
      options.updatedAt ?? pinned?.updatedAt ?? Math.floor(Date.now() / 1000),
    wallet: options.wallet ?? pinned?.wallet ?? config.referrer.wallet,
  };
  return assertStoreManifestBody(body);
}

/**
 * Build the SERVED envelope for `/.well-known/agenc-store.json` from the store
 * config — the one helper every template route wraps.
 *
 * - With `config.manifest.signature` set: returns the signed envelope, but
 *   ONLY after verifying the configured signature against the derived body
 *   (fail closed — a config edited after signing throws instead of serving a
 *   manifest every verifier would reject).
 * - Without a signature: returns the unsigned envelope (`signature: null`,
 *   `status: "unsigned"`) plus a `signing` hint block carrying the canonical
 *   hash and the EXACT message to sign, so the owner can complete the
 *   one-signature flow from the route output alone (docs/STORE_MANIFEST.md).
 *
 * @param config - The validated `StoreConfig`.
 * @param options - Per-call overrides ({@link BuildStoreManifestOptions}).
 * @returns The {@link StoreManifestEnvelope} to serve.
 * @throws StoreManifestError when the configured signature does not verify.
 */
export async function storeManifestEnvelopeFromConfig(
  config: StoreConfig,
  options: BuildStoreManifestOptions = {},
): Promise<StoreManifestEnvelope> {
  const body = buildStoreManifest(config, options);
  const signature = config.manifest?.signature;

  if (signature === undefined) {
    const hashHex = await storeManifestHashHex(body);
    const unsigned: UnsignedStoreManifest = {
      body,
      wallet: body.wallet,
      signature: null,
      status: "unsigned",
      signing: {
        sha256: hashHex,
        message: storeManifestSigningMessage(hashHex),
      },
    };
    return unsigned;
  }

  const envelope: StoreManifestEnvelope = {
    body,
    wallet: body.wallet,
    signature,
    status: "signed",
  };
  const check = await verifyStoreManifest(envelope);
  if (!check.ok) {
    throw new StoreManifestError(
      check.status === "invalid" ? check.code : "SIGNATURE_INVALID",
      "manifest.signature in agenc.config.ts does not verify against the " +
        "derived manifest body. The signature covers the EXACT config-derived " +
        "bytes — any config change (name, fees, origin, moderation, agents, " +
        "updatedAt, …) requires re-signing. See docs/STORE_MANIFEST.md.",
    );
  }
  return envelope;
}
