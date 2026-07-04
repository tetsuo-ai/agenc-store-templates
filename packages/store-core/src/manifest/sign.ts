/**
 * `signStoreManifest` — produce a signed `agenc.storeManifest.v1` envelope
 * through a SIGNER CALLBACK seam. This module never touches key material: the
 * caller supplies a function that signs message bytes (a wallet adapter's
 * `signMessage`, a kit `CryptoKeyPair` via `signBytes`, a hardware wallet —
 * anything that does ed25519 detached over raw bytes).
 *
 * Fail closed: the produced envelope is VERIFIED against `body.wallet` before
 * it is returned, so a signer whose key does not match the manifest's owner
 * wallet can never yield a served-but-unverifiable manifest.
 *
 * @module manifest/sign
 */
import { getBase58Decoder } from "@solana/kit";
import { storeManifestHashHex, storeManifestSigningBytes } from "./canonical.js";
import {
  assertStoreManifestBody,
  StoreManifestError,
  type SignedStoreManifest,
  type StoreManifestBody,
} from "./schema.js";
import { verifyStoreManifest } from "./verify.js";

/**
 * The signing seam: given the exact signing-message BYTES, return the 64-byte
 * ed25519 detached signature by the store owner's wallet. Implementations:
 *
 * - Wallet Standard / wallet adapter: `(m) => signMessage(m)`;
 * - kit keypair: `(m) => signBytes(keyPair.privateKey, m)`;
 * - anything else that signs raw bytes with the owner key.
 */
export type StoreManifestSigner = (
  message: Uint8Array,
) => Promise<Uint8Array> | Uint8Array;

/**
 * Sign a manifest body and return the served envelope
 * `{ body, wallet, signature, status: "signed" }`.
 *
 * @param body - The manifest body (validated; `body.wallet` is the signer).
 * @param signer - The {@link StoreManifestSigner} callback.
 * @returns The verified {@link SignedStoreManifest}.
 * @throws StoreManifestError `MANIFEST_MALFORMED` on an invalid body,
 *   `SIGNATURE_MALFORMED` when the signer returns non-64-byte output, and
 *   `SIGNATURE_INVALID` when the produced signature does not verify against
 *   `body.wallet` (i.e. the signer used a different key).
 */
export async function signStoreManifest(
  body: StoreManifestBody,
  signer: StoreManifestSigner,
): Promise<SignedStoreManifest> {
  const validated = assertStoreManifestBody(body);
  const hashHex = await storeManifestHashHex(validated);
  const signature = await signer(storeManifestSigningBytes(hashHex));
  if (!(signature instanceof Uint8Array) || signature.length !== 64) {
    throw new StoreManifestError(
      "SIGNATURE_MALFORMED",
      "signer must return a 64-byte ed25519 detached signature",
    );
  }

  const envelope: SignedStoreManifest = {
    body: validated,
    wallet: validated.wallet,
    signature: getBase58Decoder().decode(signature),
    status: "signed",
  };

  // Fail closed: prove the signer key IS body.wallet before handing the
  // envelope to anyone.
  const check = await verifyStoreManifest(envelope);
  if (!check.ok) {
    throw new StoreManifestError(
      check.status === "invalid" ? check.code : "SIGNATURE_INVALID",
      "produced signature does not verify against body.wallet — the signer " +
        "callback must sign with the manifest's owner wallet " +
        `(${validated.wallet})`,
    );
  }
  return envelope;
}
