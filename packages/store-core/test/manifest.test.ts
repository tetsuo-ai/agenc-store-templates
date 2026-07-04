/**
 * `agenc.storeManifest.v1` reference-implementation tests (P5.2 step 1).
 *
 * Four groups:
 *  1. **Canonicalization vectors** — the committed byte-exact hashes in
 *     `manifest-vectors.json` are the CROSS-IMPLEMENTATION anchor other repos
 *     test against; a drift here is a breaking change to the standard.
 *  2. **Sign/verify round-trip** with a generated ed25519 key.
 *  3. **Tamper detection** — mutating ANY signed field fails verify.
 *  4. **Config derivation + unsigned handling** — `buildStoreManifest` /
 *     `storeManifestEnvelopeFromConfig`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  address,
  generateKeyPairSigner,
  getAddressFromPublicKey,
  getBase58Decoder,
  signBytes,
} from "@solana/kit";
import { defineStore } from "../src/config/define-store.js";
import {
  buildStoreManifest,
  canonicalStoreManifestJson,
  signStoreManifest,
  storeManifestEnvelopeFromConfig,
  storeManifestHashHex,
  storeManifestSigningBytes,
  storeManifestSigningMessage,
  StoreManifestError,
  verifyStoreManifest,
  type StoreManifestBody,
} from "../src/manifest/index.js";
import { FULL_CONFIG } from "./fixtures.js";

const VECTORS = JSON.parse(
  readFileSync(fileURLToPath(new URL("./manifest-vectors.json", import.meta.url)), "utf8"),
) as {
  vectors: {
    name: string;
    body: StoreManifestBody;
    canonicalJson: string;
    sha256: string;
  }[];
};

/** Generate a signer + its base58 wallet, and a callback that signs bytes with it. */
async function makeSigner() {
  const signer = await generateKeyPairSigner();
  // Keep the branded `Address` (base58 string subtype) so it satisfies the
  // manifest body's branded `wallet`/`operator`/agent fields.
  const wallet = await getAddressFromPublicKey(signer.keyPair.publicKey);
  const sign = async (message: Uint8Array) =>
    new Uint8Array(await signBytes(signer.keyPair.privateKey, message));
  return { wallet, sign };
}

describe("canonicalization vectors (cross-implementation anchor)", () => {
  for (const vector of VECTORS.vectors) {
    it(`vector "${vector.name}" produces the committed canonical JSON`, () => {
      expect(canonicalStoreManifestJson(vector.body)).toBe(vector.canonicalJson);
    });

    it(`vector "${vector.name}" produces the committed sha-256`, async () => {
      expect(await storeManifestHashHex(vector.body)).toBe(vector.sha256);
    });
  }

  it("is order-independent: shuffled input keys yield the SAME canonical bytes", () => {
    const vector = VECTORS.vectors[0]!;
    const shuffled: Record<string, unknown> = {};
    for (const key of Object.keys(vector.body).reverse()) {
      shuffled[key] = (vector.body as Record<string, unknown>)[key];
    }
    expect(canonicalStoreManifestJson(shuffled as StoreManifestBody)).toBe(
      vector.canonicalJson,
    );
  });
});

describe("signing message envelope (spec §7.3)", () => {
  it("is the exact domain-neutral template with NO surface string", () => {
    const hashHex = VECTORS.vectors[0]!.sha256;
    expect(storeManifestSigningMessage(hashHex)).toBe(
      `agenc store manifest v1\nsha256: ${hashHex}`,
    );
    expect(storeManifestSigningMessage(hashHex)).not.toContain("agenc.ag");
  });

  it("rejects a non-lowercase-hex hash (would silently produce a bad signature)", () => {
    expect(() => storeManifestSigningMessage("NOTHEX")).toThrow(TypeError);
    expect(() =>
      storeManifestSigningMessage(VECTORS.vectors[0]!.sha256.toUpperCase()),
    ).toThrow(TypeError);
  });
});

describe("sign / verify round-trip", () => {
  it("verifies a freshly signed manifest", async () => {
    const { wallet, sign } = await makeSigner();
    const body: StoreManifestBody = { ...VECTORS.vectors[0]!.body, wallet };
    const signed = await signStoreManifest(body, sign);

    expect(signed.status).toBe("signed");
    expect(signed.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);

    const result = await verifyStoreManifest(signed);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("verified");
    if (result.ok) {
      expect(result.wallet).toBe(wallet);
      expect(result.hashHex).toBe(await storeManifestHashHex(body));
    }
  });

  it("passes the origin check on its own origin and fails when copied elsewhere", async () => {
    const { wallet, sign } = await makeSigner();
    const body: StoreManifestBody = {
      ...VECTORS.vectors[0]!.body,
      wallet,
      origin: "https://store.example.com",
    };
    const signed = await signStoreManifest(body, sign);

    const onOrigin = await verifyStoreManifest(signed, {
      expectedOrigin: "https://store.example.com",
    });
    expect(onOrigin.ok).toBe(true);

    const copied = await verifyStoreManifest(signed, {
      expectedOrigin: "https://evil.com",
    });
    expect(copied.ok).toBe(false);
    if (!copied.ok && copied.status === "invalid") {
      expect(copied.code).toBe("ORIGIN_MISMATCH");
    }
  });

  it("skips the origin check for a hosted store (origin === \"\")", async () => {
    const { wallet, sign } = await makeSigner();
    const body: StoreManifestBody = {
      ...VECTORS.vectors[2]!.body,
      wallet,
    };
    const signed = await signStoreManifest(body, sign);
    const result = await verifyStoreManifest(signed, {
      expectedOrigin: "https://anywhere.example.com",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a signer whose key is not body.wallet (fail closed at sign time)", async () => {
    const { sign } = await makeSigner();
    const other = await makeSigner();
    const body: StoreManifestBody = {
      ...VECTORS.vectors[0]!.body,
      wallet: other.wallet, // body claims a DIFFERENT owner than the signer
    };
    await expect(signStoreManifest(body, sign)).rejects.toBeInstanceOf(
      StoreManifestError,
    );
  });

  it("rejects a signer that returns non-64-byte output", async () => {
    const { wallet } = await makeSigner();
    const body: StoreManifestBody = { ...VECTORS.vectors[0]!.body, wallet };
    await expect(
      signStoreManifest(body, () => new Uint8Array(10)),
    ).rejects.toMatchObject({ code: "SIGNATURE_MALFORMED" });
  });
});

describe("tamper detection", () => {
  it("fails verify when ANY signed field is mutated", async () => {
    const { wallet, sign } = await makeSigner();
    const body: StoreManifestBody = { ...VECTORS.vectors[1]!.body, wallet };
    const signed = await signStoreManifest(body, sign);

    const mutations: ((b: StoreManifestBody) => StoreManifestBody)[] = [
      (b) => ({ ...b, title: "Evil Store" }),
      (b) => ({ ...b, referrerFeeBps: b.referrerFeeBps + 1 }),
      (b) => ({ ...b, operatorFeeBps: b.operatorFeeBps + 1 }),
      (b) => ({ ...b, handle: "other-handle" }),
      (b) => ({ ...b, updatedAt: b.updatedAt + 1 }),
      (b) => ({ ...b, agents: [] }),
      (b) => ({
        ...b,
        moderation: { ...b.moderation, moderator: VECTORS.vectors[0]!.body.wallet },
      }),
    ];

    for (const mutate of mutations) {
      const tampered = { ...signed, body: mutate(signed.body) };
      const result = await verifyStoreManifest(tampered);
      expect(result.ok, `expected mutation to fail: ${JSON.stringify(mutate(signed.body))}`).toBe(false);
      if (!result.ok && result.status === "invalid") {
        expect(result.code).toBe("SIGNATURE_INVALID");
      }
    }
  });

  it("fails verify when envelope.wallet is swapped away from body.wallet", async () => {
    const { wallet, sign } = await makeSigner();
    const other = await makeSigner();
    const body: StoreManifestBody = { ...VECTORS.vectors[0]!.body, wallet };
    const signed = await signStoreManifest(body, sign);
    const result = await verifyStoreManifest({ ...signed, wallet: other.wallet });
    expect(result.ok).toBe(false);
    if (!result.ok && result.status === "invalid") {
      expect(result.code).toBe("WALLET_MISMATCH");
    }
  });

  it("fails verify on a malformed signature", async () => {
    const { wallet, sign } = await makeSigner();
    const body: StoreManifestBody = { ...VECTORS.vectors[0]!.body, wallet };
    const signed = await signStoreManifest(body, sign);
    // Replace with a valid-length base58 signature of the wrong bytes.
    const wrong = getBase58Decoder().decode(new Uint8Array(64).fill(7));
    const result = await verifyStoreManifest({ ...signed, signature: wrong });
    expect(result.ok).toBe(false);
    if (!result.ok && result.status === "invalid") {
      expect(result.code).toBe("SIGNATURE_INVALID");
    }
  });

  it("rejects a malformed envelope (fail closed, not throw)", async () => {
    const result = await verifyStoreManifest({ nonsense: true });
    expect(result.ok).toBe(false);
    if (!result.ok && result.status === "invalid") {
      expect(result.code).toBe("MANIFEST_MALFORMED");
    }
  });
});

describe("unsigned manifest handling", () => {
  it("verify returns status 'unsigned' (unverified, NOT invalid) for signature: null", async () => {
    const { wallet } = await makeSigner();
    const body: StoreManifestBody = { ...VECTORS.vectors[0]!.body, wallet };
    const result = await verifyStoreManifest({
      body,
      wallet,
      signature: null,
      status: "unsigned",
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("unsigned");
    if (result.status === "unsigned") {
      expect(result.wallet).toBe(wallet);
    }
  });
});

describe("config derivation (buildStoreManifest / storeManifestEnvelopeFromConfig)", () => {
  it("derives the manifest body from a full store config (fees + Q7 moderation)", () => {
    const config = defineStore({
      ...FULL_CONFIG,
      operator: { wallet: FULL_CONFIG.referrer.wallet, feeBps: 100 },
      moderation: { moderator: FULL_CONFIG.referrer.wallet },
      manifest: { updatedAt: 1751500000 },
    });
    const body = buildStoreManifest(config);
    expect(body.schema).toBe("agenc.storeManifest.v1");
    expect(body.wallet).toBe(FULL_CONFIG.referrer.wallet);
    expect(body.referrerFeeBps).toBe(FULL_CONFIG.referrer.feeBps);
    expect(body.operator).toBe(FULL_CONFIG.referrer.wallet);
    expect(body.operatorFeeBps).toBe(100);
    expect(body.moderation?.moderator).toBe(FULL_CONFIG.referrer.wallet);
    expect(body.origin).toBe("https://store.example.com");
    expect(body.updatedAt).toBe(1751500000);
    // curation.providers flows into agents by default.
    expect(body.agents).toEqual(FULL_CONFIG.curation!.providers);
  });

  it("serves an UNSIGNED envelope with a signing hint when no signature is configured", async () => {
    const config = defineStore({ ...FULL_CONFIG, manifest: { updatedAt: 1751500000 } });
    const envelope = await storeManifestEnvelopeFromConfig(config);
    expect(envelope.signature).toBeNull();
    expect(envelope.status).toBe("unsigned");
    expect(envelope.signing?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(envelope.signing?.message).toBe(
      storeManifestSigningMessage(envelope.signing!.sha256),
    );
  });

  it("serves a SIGNED envelope when a valid config signature is present, and fails closed on a stale one", async () => {
    const { wallet, sign } = await makeSigner();
    const base = defineStore({
      ...FULL_CONFIG,
      referrer: { wallet, feeBps: FULL_CONFIG.referrer.feeBps },
      curation: { requireModeration: true },
      manifest: { updatedAt: 1751500000 },
    });
    const body = buildStoreManifest(base);
    const signed = await signStoreManifest(body, sign);

    const goodConfig = defineStore({
      ...FULL_CONFIG,
      referrer: { wallet, feeBps: FULL_CONFIG.referrer.feeBps },
      curation: { requireModeration: true },
      manifest: { updatedAt: 1751500000, signature: signed.signature },
    });
    const envelope = await storeManifestEnvelopeFromConfig(goodConfig);
    expect(envelope.status).toBe("signed");
    const verified = await verifyStoreManifest(envelope);
    expect(verified.ok).toBe(true);

    // Mutate the config AFTER signing → the pinned signature is stale.
    const staleConfig = defineStore({
      ...FULL_CONFIG,
      name: "Renamed After Signing",
      referrer: { wallet, feeBps: FULL_CONFIG.referrer.feeBps },
      curation: { requireModeration: true },
      manifest: { updatedAt: 1751500000, signature: signed.signature },
    });
    await expect(storeManifestEnvelopeFromConfig(staleConfig)).rejects.toBeInstanceOf(
      StoreManifestError,
    );
  });
});
