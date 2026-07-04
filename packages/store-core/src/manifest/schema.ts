/**
 * `agenc.storeManifest.v1` — the portable, domain-neutral store identity
 * manifest (P5.2 step 1, `agenc-protocol/docs/P5_2_STORE_IDENTITY_SPEC.md`
 * §4/§7.3). A store's wallet signs the canonical manifest body, and the store
 * serves the signed envelope at `/.well-known/agenc-store.json` — so ANY
 * surface (agenc.ag, another node, a third-party verifier) can prove "this
 * wallet authored exactly this store config" without trusting any registry.
 *
 * Deliberately, NO surface-bound string appears anywhere in the signing
 * envelope (the fix for the `agenc.ag store claim` binding): the message is
 * `agenc store manifest v1\nsha256: <hash>` and domain intent lives INSIDE the
 * signed body as the `origin` field.
 *
 * @module manifest/schema
 */
import { isAddress } from "@solana/kit";
import { z } from "zod";

/** The manifest schema marker (same versioning discipline as `agenc.agentCard.v1`). */
export const STORE_MANIFEST_SCHEMA = "agenc.storeManifest.v1" as const;

/**
 * The conventional serving path on a dedicated-domain store. A convention, not
 * a requirement — hosted multi-tenant stores serve per-store manifest URLs
 * instead (spec §7.3).
 */
export const STORE_MANIFEST_WELL_KNOWN_PATH =
  "/.well-known/agenc-store.json" as const;

/**
 * Display-handle charset: lowercase `[a-z0-9-]`, 3–20 chars, starts
 * alphanumeric. The EXACT mirror of agenc.ag's `HANDLE_RE`
 * (`store-types.ts:9`) and the spec §6 on-chain charset floor. Handles are
 * display-only and per-surface — never a uniqueness key.
 */
export const STORE_MANIFEST_HANDLE_RE = /^[a-z0-9][a-z0-9-]{2,19}$/;

/** Matches a 32-byte lowercase-hex sha-256 digest. */
export const STORE_MANIFEST_HASH_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Matches a base58-encoded 64-byte ed25519 signature (length bounds only; the
 * exact 64-byte length is re-checked after decoding).
 */
export const STORE_MANIFEST_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

/**
 * Combined on-chain fee cap (bps) shared by the referrer/operator legs —
 * mirrors `REFERRER_COMBINED_FEE_BPS_CAP` in `config/schema.ts` (kept local so
 * the manifest module never imports the config module: `config/schema.ts`
 * imports THIS file for the shared handle/signature charsets, and a cycle
 * would break the build).
 */
const COMBINED_FEE_BPS_CAP = 4000;

/**
 * Accepts only valid base58 Solana addresses (local copy of the config
 * module's private refinement — see {@link COMBINED_FEE_BPS_CAP} for why this
 * module must not import `config/schema.ts`).
 */
const base58Address = z.string().refine((value) => isAddress(value), {
  message: "must be a valid base58 Solana address",
});

/**
 * `""` (a hosted store with no own domain) or an exact URL origin — scheme +
 * host (+ non-default port), no path, no trailing slash. `new URL(v).origin`
 * must round-trip to the input so `https://x.com/` or `https://x.com/store`
 * can never sneak in as an "origin".
 */
const originSchema = z.string().refine(
  (value) => {
    if (value === "") return true;
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.origin === value
      );
    } catch {
      return false;
    }
  },
  {
    message:
      'origin must be "" (hosted store) or an exact http(s) URL origin with ' +
      "no path or trailing slash (e.g. https://store.example.com)",
  },
);

/**
 * The store's moderation posture — included in the SIGNED body (spec §8 Q7,
 * founder-ratified YES) so a store's trusted moderator / attestation endpoint
 * is portable and verifiable. Mirrors the config `moderationSchema` fields
 * (`config/schema.ts`). Present only when the store declares a posture; an
 * empty object is rejected (omit the key instead).
 */
export const storeManifestModerationSchema = z
  .object({
    /** Self-hosted task-moderation attestation endpoint, when overridden. */
    attestorEndpoint: z
      .string()
      .url("moderation.attestorEndpoint must be an absolute URL")
      .optional(),
    /** The trusted moderator/attestor signer pubkey, when pinned. */
    moderator: base58Address.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message:
      "moderation must declare at least one field — omit the key entirely " +
      "for a store with no explicit moderation posture",
  });

/** {@link storeManifestModerationSchema} as a TypeScript type. */
export type StoreManifestModeration = z.infer<
  typeof storeManifestModerationSchema
>;

/**
 * The canonical manifest BODY — exactly the spec §4 field list. This object
 * (canonicalized per `manifest/canonical.ts`) is what the sha-256 hash covers
 * and therefore what the wallet signs.
 *
 * Optional keys (`moderation`, `storePda`) are OMITTED when absent — never
 * emitted as `null` — so two implementations always produce identical bytes.
 * All other keys are always present (`operator: ""` / `operatorFeeBps: 0`
 * when the store has no operator terms — the `canonicalStoreClaimPayload`
 * empty-value discipline).
 */
export const storeManifestBodySchema = z
  .object({
    /** Curated/owned agent PDAs this store advertises (may be empty). */
    agents: z.array(base58Address),
    /** Display handle ({@link STORE_MANIFEST_HANDLE_RE}). NOT a uniqueness key. */
    handle: z
      .string()
      .regex(
        STORE_MANIFEST_HANDLE_RE,
        "handle must be lowercase [a-z0-9-], 3-20 chars, starting alphanumeric",
      ),
    /** Moderation posture (Q7). Omitted when the store declares none. */
    moderation: storeManifestModerationSchema.optional(),
    /** Advertised default operator payee, or `""` for none. */
    operator: z.union([z.literal(""), base58Address]),
    /** Advertised default operator fee in bps. */
    operatorFeeBps: z
      .number()
      .int("operatorFeeBps must be an integer number of basis points")
      .min(0)
      .max(COMBINED_FEE_BPS_CAP),
    /** The http(s) origin this manifest is authoritative for; `""` = hosted. */
    origin: originSchema,
    /** Advertised default referral fee in bps. */
    referrerFeeBps: z
      .number()
      .int("referrerFeeBps must be an integer number of basis points")
      .min(0)
      .max(COMBINED_FEE_BPS_CAP),
    /** Schema marker. */
    schema: z.literal(STORE_MANIFEST_SCHEMA),
    /** The on-chain Store PDA, once Architecture A ships. Omitted until then. */
    storePda: base58Address.optional(),
    /** Store display title. */
    title: z.string().min(1, "title must not be empty"),
    /** Unix timestamp (seconds) this manifest body was authored. */
    updatedAt: z
      .number()
      .int("updatedAt must be an integer unix timestamp in seconds")
      .positive("updatedAt must be a positive unix timestamp in seconds"),
    /** The base58 owner wallet — the identity key and the signer. */
    wallet: base58Address,
  })
  .strict()
  .superRefine((value, ctx) => {
    // The create_service_listing pairing rule (spec §7.2): a fee with no payee
    // can never be honored on-chain, so it must never be signed either.
    if (value.operatorFeeBps > 0 && value.operator === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operator"],
        message:
          "operator is required when operatorFeeBps > 0 (a fee with no payee " +
          "cannot be honored at settlement)",
      });
    }
  });

/** {@link storeManifestBodySchema} as a TypeScript type. */
export type StoreManifestBody = z.infer<typeof storeManifestBodySchema>;

/**
 * The signing hint block a store serves alongside an UNSIGNED manifest so the
 * owner can complete the one-signature flow with nothing but the route output:
 * sign `message` with the owner wallet, embed the signature in
 * `agenc.config.ts`. Never part of the signed content.
 */
export const storeManifestSigningHintSchema = z
  .object({
    /** Lowercase hex sha-256 of the canonical body. */
    sha256: z.string().regex(STORE_MANIFEST_HASH_HEX_RE),
    /** The exact signing message (`agenc store manifest v1\nsha256: <hash>`). */
    message: z.string(),
  })
  .strict();

/** {@link storeManifestSigningHintSchema} as a TypeScript type. */
export type StoreManifestSigningHint = z.infer<
  typeof storeManifestSigningHintSchema
>;

/**
 * The served envelope: `{ body, wallet, signature }` (spec §7.3), where
 * `signature` is the base58 64-byte ed25519 detached signature by `wallet`
 * over the signing message — or `null` for a not-yet-signed store, which
 * surfaces MUST treat as UNVERIFIED (never as invalid).
 *
 * `status` and (unsigned-only) `signing` are additive serving conveniences;
 * they carry no authority and are excluded from the signed content by
 * construction (only `body` is hashed).
 */
export const storeManifestEnvelopeSchema = z
  .object({
    /** The canonical manifest body (the signed content). */
    body: storeManifestBodySchema,
    /** The signer wallet. MUST equal `body.wallet` (fail closed on mismatch). */
    wallet: base58Address,
    /** Base58 ed25519 signature, or `null` when not yet signed. */
    signature: z
      .union([z.string().regex(STORE_MANIFEST_SIGNATURE_RE), z.null()]),
    /** Clearly-typed signing state for surfaces. */
    status: z.enum(["signed", "unsigned"]).optional(),
    /** Owner signing hint — served with unsigned manifests only. */
    signing: storeManifestSigningHintSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.signature === null && value.status === "signed") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: 'status "signed" requires a signature',
      });
    }
    if (value.signature !== null && value.status === "unsigned") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: 'status "unsigned" must not carry a signature',
      });
    }
  });

/** {@link storeManifestEnvelopeSchema} as a TypeScript type. */
export type StoreManifestEnvelope = z.infer<typeof storeManifestEnvelopeSchema>;

/** A signed envelope (`signature` present). */
export type SignedStoreManifest = StoreManifestEnvelope & {
  signature: string;
};

/** An unsigned envelope (`signature: null`, `status: "unsigned"`). */
export type UnsignedStoreManifest = StoreManifestEnvelope & {
  signature: null;
  status: "unsigned";
};

/** Typed error codes for manifest build/sign/verify failures. */
export type StoreManifestErrorCode =
  | "MANIFEST_MALFORMED"
  | "WALLET_MISMATCH"
  | "ORIGIN_MISMATCH"
  | "SIGNATURE_MALFORMED"
  | "SIGNATURE_INVALID";

/**
 * The typed error every manifest helper throws — `code` is machine-readable
 * ({@link StoreManifestErrorCode}); the message says what to fix.
 */
export class StoreManifestError extends Error {
  /** Machine-readable failure code. */
  readonly code: StoreManifestErrorCode;

  constructor(code: StoreManifestErrorCode, message: string) {
    super(message);
    this.name = "StoreManifestError";
    this.code = code;
  }
}

/**
 * Validate an untrusted value as a manifest BODY. Fail closed: throws a typed
 * {@link StoreManifestError} (`MANIFEST_MALFORMED`) carrying the first zod
 * issue path + message.
 *
 * @param body - The untrusted candidate body.
 * @returns The validated {@link StoreManifestBody}.
 */
export function assertStoreManifestBody(body: unknown): StoreManifestBody {
  const parsed = storeManifestBodySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const at = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
    throw new StoreManifestError(
      "MANIFEST_MALFORMED",
      `Invalid agenc.storeManifest.v1 body${at}: ${issue?.message ?? "unknown"}`,
    );
  }
  return parsed.data;
}
