/**
 * `verifyStoreManifest` — the ~20-line spec §7.3 verification algorithm any
 * surface runs against a fetched `agenc.storeManifest.v1` envelope:
 *
 *   1. validate the envelope shape and `envelope.wallet === body.wallet`;
 *   2. (optional) require `body.origin` to equal the origin the manifest was
 *      fetched from — `""` (a hosted store) skips the check per spec;
 *   3. recompute the canonical-body sha-256 and verify the ed25519 signature
 *      by `wallet` over `agenc store manifest v1\nsha256: <hash>`.
 *
 * FAIL CLOSED: every defect is a typed `invalid` result; the ONLY non-error
 * non-verified outcome is `status: "unsigned"` (`signature: null`), which
 * surfaces MUST treat as unverified — never as invalid.
 *
 * (Step 3 of the spec algorithm — the on-chain `storePda` cross-check — needs
 * an RPC and ships with the Architecture A program batch; `body.storePda` is
 * carried and signed today so that check can be layered on without re-signing.)
 *
 * @module manifest/verify
 */
import {
  address,
  getBase58Encoder,
  getPublicKeyFromAddress,
  signatureBytes,
  verifySignature,
} from "@solana/kit";
import {
  storeManifestHashHex,
  storeManifestSigningBytes,
  storeManifestSigningMessage,
} from "./canonical.js";
import {
  storeManifestEnvelopeSchema,
  StoreManifestError,
  type StoreManifestBody,
  type StoreManifestErrorCode,
} from "./schema.js";

/** Options for {@link verifyStoreManifest}. */
export interface VerifyStoreManifestOptions {
  /**
   * The origin the manifest was fetched from (e.g. `new URL(res.url).origin`).
   * When set, a NON-EMPTY `body.origin` must equal it — the impersonation
   * check that makes a manifest copied to `evil.com` fail verification there
   * while staying valid on its own origin. `body.origin === ""` (a hosted
   * store with no own domain) skips the check, per spec §7.3.
   */
  expectedOrigin?: string;
}

/** The outcome of {@link verifyStoreManifest} — a discriminated union on `status`. */
export type StoreManifestVerification =
  | {
      /** The signature verifies and every check passed. */
      ok: true;
      status: "verified";
      /** The verified body. */
      body: StoreManifestBody;
      /** The proven owner wallet (base58). */
      wallet: string;
      /** Lowercase hex sha-256 of the canonical body. */
      hashHex: string;
      /** The exact message the signature covers. */
      message: string;
    }
  | {
      /** Well-formed but not yet signed — UNVERIFIED, not invalid. */
      ok: false;
      status: "unsigned";
      body: StoreManifestBody;
      wallet: string;
      hashHex: string;
    }
  | {
      /** Malformed, mismatched, or cryptographically invalid. */
      ok: false;
      status: "invalid";
      code: StoreManifestErrorCode;
      message: string;
    };

function invalid(
  code: StoreManifestErrorCode,
  message: string,
): StoreManifestVerification {
  return { ok: false, status: "invalid", code, message };
}

/**
 * Normalize a caller-supplied expected origin to an exact URL origin. Throws
 * a typed error on garbage so a mistyped option can never skip the check.
 */
function normalizeExpectedOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new StoreManifestError(
      "ORIGIN_MISMATCH",
      `expectedOrigin is not a valid URL/origin: ${JSON.stringify(value)}`,
    );
  }
}

/**
 * Verify an untrusted `agenc.storeManifest.v1` envelope. Never throws on bad
 * input — every failure is a typed `invalid` result (fail closed); only a
 * malformed `options.expectedOrigin` (a CALLER bug, not untrusted data)
 * throws.
 *
 * @param manifest - The untrusted envelope (e.g. parsed JSON from
 *   `/.well-known/agenc-store.json`).
 * @param options - Optional origin binding ({@link VerifyStoreManifestOptions}).
 * @returns A {@link StoreManifestVerification}.
 */
export async function verifyStoreManifest(
  manifest: unknown,
  options: VerifyStoreManifestOptions = {},
): Promise<StoreManifestVerification> {
  const expectedOrigin =
    options.expectedOrigin === undefined
      ? undefined
      : normalizeExpectedOrigin(options.expectedOrigin);

  // 1. Shape.
  const parsed = storeManifestEnvelopeSchema.safeParse(manifest);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const at = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
    return invalid(
      "MANIFEST_MALFORMED",
      `Invalid agenc.storeManifest.v1 envelope${at}: ${issue?.message ?? "unknown"}`,
    );
  }
  const envelope = parsed.data;
  const body = envelope.body;

  // 1b. Owner-wallet match: the envelope's claimed signer must be the body's
  // owner — a signature by any OTHER wallet over this body proves nothing.
  if (envelope.wallet !== body.wallet) {
    return invalid(
      "WALLET_MISMATCH",
      `envelope.wallet (${envelope.wallet}) does not match body.wallet (${body.wallet})`,
    );
  }

  // 2. Origin binding (only when the caller knows the fetch origin).
  if (
    expectedOrigin !== undefined &&
    body.origin !== "" &&
    body.origin !== expectedOrigin
  ) {
    return invalid(
      "ORIGIN_MISMATCH",
      `manifest origin ${body.origin} does not match the fetch origin ${expectedOrigin}`,
    );
  }

  // 3. Hash + signature.
  const hashHex = await storeManifestHashHex(body);
  if (envelope.signature === null) {
    return { ok: false, status: "unsigned", body, wallet: body.wallet, hashHex };
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = getBase58Encoder().encode(envelope.signature) as Uint8Array;
  } catch {
    return invalid("SIGNATURE_MALFORMED", "signature is not valid base58");
  }
  if (sigBytes.length !== 64) {
    return invalid(
      "SIGNATURE_MALFORMED",
      `signature must decode to 64 bytes (got ${sigBytes.length})`,
    );
  }

  let verified: boolean;
  try {
    const publicKey = await getPublicKeyFromAddress(address(envelope.wallet));
    verified = await verifySignature(
      publicKey,
      signatureBytes(new Uint8Array(sigBytes)),
      storeManifestSigningBytes(hashHex),
    );
  } catch {
    // An address that cannot become an ed25519 key, or a WebCrypto failure —
    // never "benefit of the doubt".
    return invalid(
      "SIGNATURE_INVALID",
      "signature verification errored (fail closed)",
    );
  }
  if (!verified) {
    return invalid(
      "SIGNATURE_INVALID",
      "ed25519 signature does not verify against body.wallet over the " +
        "canonical-body signing message",
    );
  }

  return {
    ok: true,
    status: "verified",
    body,
    wallet: body.wallet,
    hashHex,
    message: storeManifestSigningMessage(hashHex),
  };
}
