#!/usr/bin/env node
/**
 * manifest-sign.mjs — sign an `agenc.storeManifest.v1` body with a LOCAL
 * file keypair (P5.2, docs/STORE_MANIFEST.md). A dev/CLI convenience for
 * owners whose store wallet is a Solana file keypair; browser-wallet owners
 * sign the served `signing.message` with their wallet's `signMessage` instead.
 *
 *   node node_modules/@tetsuo-ai/store-core/scripts/manifest-sign.mjs \
 *     <keypair.json> <manifest-url-or-file>
 *
 * - <keypair.json>: a Solana file keypair (the 64-number JSON array). LOCAL
 *   signing only — nothing is broadcast and the key never leaves this process.
 * - <manifest-url-or-file>: the store's `/.well-known/agenc-store.json` URL
 *   (e.g. http://localhost:3000/.well-known/agenc-store.json) or a saved copy.
 *
 * The script re-canonicalizes and re-hashes the body itself (it never trusts
 * the served `signing` hint), signs the domain-neutral message
 * `agenc store manifest v1\nsha256: <hash>`, verifies the signature against
 * the body's wallet, and prints the `manifest:` snippet to paste into
 * `agenc.config.ts`. Self-contained on node:crypto — no dependencies.
 */
import { readFile } from "node:fs/promises";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
} from "node:crypto";

// ------------------------------------------------------------------- base58
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** @param {Uint8Array} bytes */
function base58Encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return "1".repeat(zeros) + out;
}

// -------------------------------------------------- canonical json (v1 spec)
/** json-stable-v1: recursively key-sorted, no whitespace, fail on non-JSON. */
function canonicalize(value, path) {
  if (value === null) return null;
  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`non-finite number at ${path}`);
      return value;
    case "object":
      break;
    default:
      throw new TypeError(`unsupported ${typeof value} at ${path}`);
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => (v === undefined ? null : canonicalize(v, `${path}[${i}]`)));
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    out[key] = canonicalize(value[key], `${path}.${key}`);
  }
  return out;
}

// ------------------------------------------------------------------ ed25519
/** Wrap a raw 32-byte ed25519 seed as a PKCS8 DER private key. */
function pkcs8FromSeed(seed) {
  const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  return createPrivateKey({
    key: Buffer.concat([prefix, Buffer.from(seed)]),
    format: "der",
    type: "pkcs8",
  });
}

async function main() {
  const [keypairPath, manifestSrc] = process.argv.slice(2);
  if (!keypairPath || !manifestSrc) {
    console.error(
      "usage: manifest-sign.mjs <keypair.json> <manifest-url-or-file>\n" +
        "  e.g. node scripts/manifest-sign.mjs ~/my-store-owner.json \\\n" +
        "       http://localhost:3000/.well-known/agenc-store.json",
    );
    process.exit(2);
  }

  // Load the keypair (Solana file format: 64 numbers = 32 seed + 32 pubkey).
  const raw = JSON.parse(await readFile(keypairPath, "utf8"));
  if (!Array.isArray(raw) || raw.length !== 64) {
    console.error("keypair file must be the Solana 64-number JSON array");
    process.exit(1);
  }
  const seed = Uint8Array.from(raw.slice(0, 32));
  const walletB58 = base58Encode(Uint8Array.from(raw.slice(32)));
  const privateKey = pkcs8FromSeed(seed);
  const publicKey = createPublicKey(privateKey);

  // Load the envelope (URL or file) and take ONLY the body.
  let envelopeText;
  if (/^https?:\/\//.test(manifestSrc)) {
    const res = await fetch(manifestSrc);
    if (!res.ok) {
      console.error(`fetch failed: ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    envelopeText = await res.text();
  } else {
    envelopeText = await readFile(manifestSrc, "utf8");
  }
  const envelope = JSON.parse(envelopeText);
  const body = envelope?.body ?? envelope;
  if (!body || body.schema !== "agenc.storeManifest.v1") {
    console.error('input has no body with schema "agenc.storeManifest.v1"');
    process.exit(1);
  }
  if (body.wallet !== walletB58) {
    console.error(
      `manifest body.wallet (${body.wallet}) is not this keypair's wallet ` +
        `(${walletB58}) — sign with the OWNER wallet or fix manifest.wallet ` +
        "in agenc.config.ts",
    );
    process.exit(1);
  }

  // Re-canonicalize + hash locally (never trust the served signing hint).
  const canonicalJson = JSON.stringify(canonicalize(body, "$"));
  const hashHex = createHash("sha256").update(canonicalJson, "utf8").digest("hex");
  const message = `agenc store manifest v1\nsha256: ${hashHex}`;
  const messageBytes = Buffer.from(message, "utf8");

  const signature = edSign(null, messageBytes, privateKey);
  if (!edVerify(null, messageBytes, publicKey, signature)) {
    console.error("produced signature failed self-verification (fail closed)");
    process.exit(1);
  }

  const sigB58 = base58Encode(new Uint8Array(signature));
  console.log(`wallet:        ${walletB58}`);
  console.log(`canonical sha: ${hashHex}`);
  console.log(`message:       ${JSON.stringify(message)}`);
  console.log(`signature:     ${sigB58}`);
  console.log("");
  console.log("Paste into agenc.config.ts (pin updatedAt to the SIGNED value):");
  console.log("");
  console.log("  manifest: {");
  console.log(`    updatedAt: ${body.updatedAt},`);
  console.log(`    signature: "${sigB58}",`);
  console.log("  },");
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
