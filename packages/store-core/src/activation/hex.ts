/**
 * Tiny hex helpers shared by the activation client + server. Local (not the
 * SDK's `values.hexToBytes`) so the CLIENT bundle stays free of any sdk import
 * — the browser seam only ships fetch + these few lines.
 *
 * @module activation/hex
 */

/** Matches a 32-byte lowercase/uppercase hex string. */
export const HASH_HEX_RE = /^[0-9a-f]{64}$/i;

/** Encode bytes as lowercase hex. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Decode a hex string to bytes.
 *
 * @throws when the input has odd length or non-hex characters.
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error("invalid hex string");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
