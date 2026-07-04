/**
 * Canonicalization + the signing envelope for `agenc.storeManifest.v1`
 * (spec §7.3 — the NORMATIVE definition; this file implements it byte-exactly).
 *
 * ## Canonical form
 *
 * UTF-8 bytes of `JSON.stringify` over the recursively KEY-SORTED body with no
 * whitespace — the ecosystem's `json-stable-v1` discipline (the exact
 * semantics of the SDK's `values.canonicalJobSpecJson` and agenc.ag's
 * `canonicalStoreClaimPayload` fixed-key-order rule):
 *
 * - object keys sorted with `Array.prototype.sort()` (code-unit order),
 *   recursively at every depth;
 * - `undefined` object entries dropped; `undefined` array items become `null`;
 * - non-finite numbers and non-JSON values (functions, bigints, symbols)
 *   REJECTED — never silently coerced;
 * - strings emitted with `JSON.stringify`'s minimal escaping (non-ASCII stays
 *   literal), then encoded as UTF-8.
 *
 * ## The signing envelope
 *
 * `signature` = ed25519 detached, by the owner wallet, over the UTF-8 bytes of
 *
 * ```
 * agenc store manifest v1\nsha256: <lowercase hex sha-256 of canonical body>
 * ```
 *
 * Deliberately DOMAIN-NEUTRAL — no surface string (like `agenc.ag store
 * claim`) appears in the message, so any surface can issue and verify the
 * proof. Domain intent is carried by the signed body's `origin` field instead.
 *
 * @module manifest/canonical
 */
import { bytesToHex } from "../activation/hex.js";
import {
  assertStoreManifestBody,
  STORE_MANIFEST_HASH_HEX_RE,
  type StoreManifestBody,
} from "./schema.js";

/** The domain-neutral signing-message prefix (spec §7.3). */
export const STORE_MANIFEST_SIGNING_PREFIX = "agenc store manifest v1" as const;

/**
 * Recursively produce the key-sorted mirror of a JSON value (`json-stable-v1`
 * semantics — see the module doc). Throws `TypeError` on non-JSON input so a
 * malformed body can never be silently canonicalized into signable bytes.
 */
function canonicalize(value: unknown, path: string): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(`storeManifest canonical: non-finite number at ${path}`);
      }
      return value;
    case "object":
      break;
    default:
      throw new TypeError(
        `storeManifest canonical: unsupported ${typeof value} value at ${path}`,
      );
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      item === undefined ? null : canonicalize(item, `${path}[${index}]`),
    );
  }
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const item = source[key];
    if (item === undefined) continue;
    out[key] = canonicalize(item, `${path}.${key}`);
  }
  return out;
}

/**
 * The canonical JSON string of a manifest body (validated first — an invalid
 * body throws a typed `StoreManifestError` and never becomes signable bytes).
 *
 * @param body - The manifest body.
 * @returns Sorted-key, no-whitespace JSON.
 */
export function canonicalStoreManifestJson(body: StoreManifestBody): string {
  const validated = assertStoreManifestBody(body);
  return JSON.stringify(canonicalize(validated, "$"));
}

/**
 * The canonical BYTES of a manifest body — UTF-8 of
 * {@link canonicalStoreManifestJson}. These are the bytes the sha-256 hash
 * (and therefore the signature) covers.
 *
 * @param body - The manifest body.
 * @returns UTF-8 canonical bytes.
 */
export function canonicalStoreManifestBytes(body: StoreManifestBody): Uint8Array {
  return new TextEncoder().encode(canonicalStoreManifestJson(body));
}

/**
 * Lowercase-hex sha-256 of the canonical body bytes. Async because it uses
 * WebCrypto (`crypto.subtle`) — available in Node ≥ 20, browsers, and edge
 * runtimes alike (the same primitive the SDK's job-spec hashing uses).
 *
 * @param body - The manifest body.
 * @returns The 64-char lowercase hex digest.
 */
export async function storeManifestHashHex(
  body: StoreManifestBody,
): Promise<string> {
  const bytes = canonicalStoreManifestBytes(body);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    // Copy into a plain ArrayBuffer-backed view for the WebCrypto call.
    bytes.slice(),
  );
  return bytesToHex(new Uint8Array(digest));
}

/**
 * The EXACT signing message for a canonical-body hash (spec §7.3):
 *
 * ```
 * agenc store manifest v1\nsha256: <hashHex>
 * ```
 *
 * @param hashHex - The 64-char LOWERCASE hex sha-256 of the canonical body.
 * @returns The message string whose UTF-8 bytes the wallet signs.
 * @throws TypeError when `hashHex` is not exactly 64 lowercase hex chars —
 *   an uppercase or truncated hash would silently produce an unverifiable
 *   signature, so it is rejected here.
 */
export function storeManifestSigningMessage(hashHex: string): string {
  if (!STORE_MANIFEST_HASH_HEX_RE.test(hashHex)) {
    throw new TypeError(
      "storeManifestSigningMessage: hashHex must be the 64-char lowercase " +
        "hex sha-256 of the canonical manifest body",
    );
  }
  return `${STORE_MANIFEST_SIGNING_PREFIX}\nsha256: ${hashHex}`;
}

/**
 * The UTF-8 bytes of {@link storeManifestSigningMessage} — what actually goes
 * to the ed25519 signer/verifier.
 *
 * @param hashHex - The lowercase hex canonical-body hash.
 * @returns Message bytes.
 */
export function storeManifestSigningBytes(hashHex: string): Uint8Array {
  return new TextEncoder().encode(storeManifestSigningMessage(hashHex));
}
