# `agenc.storeManifest.v1` — the portable store identity manifest

This is the reference implementation + format description for the **P5.2 step-1**
store identity primitive. The **normative** definition is
[`agenc-protocol/docs/P5_2_STORE_IDENTITY_SPEC.md`](https://github.com/tetsuo-ai/agenc-protocol/blob/main/docs/P5_2_STORE_IDENTITY_SPEC.md)
§4 (Architecture B) and §7.3; this doc restates it for third-party verifiers and
documents the store-core API + the owner signing flow.

## What it is

A store serves a **signed, domain-neutral JSON document** at
`/.well-known/agenc-store.json`. The document proves that a specific **owner
wallet authored exactly this store config** — display handle, title, origin,
referral/operator fee terms, moderation posture, and advertised agents — without
anyone having to trust a database. Any surface (agenc.ag, another node, a
20-line third-party verifier) can validate it with an ed25519 check.

The signing envelope is **domain-neutral on purpose**: no surface string (like
the legacy `agenc.ag store claim`) appears in the signed message, so the same
proof is valid on every surface. Domain intent is carried *inside* the signed
body as the `origin` field, so a manifest copied to `evil.com` fails the
origin check there while staying valid on its own origin.

## The envelope

```jsonc
{
  "body":      { /* the canonical manifest body — the signed content */ },
  "wallet":    "<base58 owner pubkey>",   // MUST equal body.wallet
  "signature": "<base58 ed25519 sig>",    // or null when not yet signed
  "status":    "signed" | "unsigned",     // serving convenience (not signed)
  "signing":   { "sha256": "...", "message": "..." }  // unsigned only
}
```

`status` and `signing` are **serving conveniences** and carry no authority —
only `body` is hashed and signed. A surface that receives `signature: null`
MUST treat the manifest as **unverified**, never as *invalid*.

## The body (spec §4 field list)

| field | type | notes |
| --- | --- | --- |
| `schema` | `"agenc.storeManifest.v1"` | schema marker |
| `wallet` | base58 | the owner pubkey (identity key + signer) |
| `handle` | `[a-z0-9-]`, 3–20, starts alnum | **display-only**, not a uniqueness key |
| `title` | string | store display title |
| `origin` | `""` or exact http(s) origin | authoritative origin; `""` = hosted store |
| `referrerFeeBps` | int 0–4000 | advertised default referral fee |
| `operator` | `""` or base58 | advertised default operator payee |
| `operatorFeeBps` | int 0–4000 | advertised default operator fee |
| `moderation` | `{ attestorEndpoint?, moderator? }` | **optional** — the store's moderation posture (§8 Q7); omitted when none |
| `agents` | base58[] | advertised/curated agent PDAs (may be empty) |
| `storePda` | base58 | **optional** — the on-chain Store PDA once Architecture A ships; omitted until then |
| `updatedAt` | int (unix seconds) | when the body was authored |

Fees are **advertised defaults, not enforcement** — the on-chain program keeps
snapshotting fee legs at listing/hire exactly as today.

## Canonicalization (byte-exact — the cross-implementation anchor)

The canonical body is the UTF-8 bytes of `JSON.stringify` over the recursively
**key-sorted** body, with **no whitespace** — the ecosystem's `json-stable-v1`
discipline (identical semantics to the SDK's `values.canonicalJobSpecJson` and
agenc.ag's `canonicalStoreClaimPayload` fixed-key-order rule):

- object keys sorted with `Array.prototype.sort()` (UTF-16 code-unit order),
  recursively at every depth;
- `undefined` object entries dropped; `undefined` array items → `null`;
- optional fields (`moderation`, `storePda`) are **omitted when absent**, never
  emitted as `null`, so two implementations produce identical bytes;
- non-finite numbers and non-JSON values are rejected, never coerced.

The hash is `sha256(<canonical UTF-8 bytes>)`, lowercase hex.

The committed vectors in
[`test/manifest-vectors.json`](../test/manifest-vectors.json) are the
compatibility anchor: any other implementation (a Rust/Python port, agenc.ag,
an independent verifier) MUST reproduce each `canonicalJson` and `sha256`
byte-for-byte. Changing a vector hash is a **breaking change** to the standard.

## The signing envelope

```
agenc store manifest v1\nsha256: <lowercase hex sha-256 of the canonical body>
```

The wallet produces an **ed25519 detached signature** over the UTF-8 bytes of
that message. Encode it as base58 for the envelope. There is **no surface
string** in the message — that is the whole point.

## Verification algorithm (any surface, ~20 lines)

1. validate the envelope shape and `envelope.wallet === body.wallet`;
2. **origin binding** (only when you know the fetch origin): if `body.origin` is
   non-empty, require it to equal the origin the manifest was fetched from
   (`body.origin === ""` = hosted store → skip);
3. recompute the canonical-body sha-256 and **ed25519-verify** the signature by
   `wallet` over `agenc store manifest v1\nsha256: <hash>`.

Fail **closed**: every defect is an `invalid` result with a typed code. The only
non-error non-verified outcome is `status: "unsigned"` (unverified).

> The spec's optional third cross-check — resolving `body.storePda` on-chain and
> requiring `owner == wallet` and `metadata_hash == sha256(body)` — ships with
> the Architecture A program batch. `storePda` is already carried and signed so
> that check layers on **without re-signing**.

## store-core API (`@tetsuo-ai/store-core/manifest`)

```ts
import {
  buildStoreManifest,                 // StoreConfig -> canonical body
  storeManifestEnvelopeFromConfig,    // StoreConfig -> served envelope (signed or unsigned)
  canonicalStoreManifestBytes,        // body -> canonical UTF-8 bytes
  storeManifestHashHex,               // body -> lowercase hex sha-256
  storeManifestSigningMessage,        // hashHex -> the exact envelope string
  signStoreManifest,                  // (body, signerCallback) -> signed envelope
  verifyStoreManifest,                // (envelope, { expectedOrigin? }) -> result
} from "@tetsuo-ai/store-core/manifest";
```

`signStoreManifest(body, signer)` takes a **signer callback**
(`(messageBytes) => Uint8Array`) — a wallet adapter's `signMessage`, a kit
keypair via `signBytes`, or a hardware wallet — and **never** a raw key. It
fails closed: the produced signature is verified against `body.wallet` before
the envelope is returned.

## Owner signing flow (the simplest honest path)

The template route serves an **unsigned** manifest until you sign it. Nothing is
broadcast — signing is a single off-chain wallet signature, no on-chain tx.

1. In `agenc.config.ts` → `manifest`, pin `updatedAt` (the signature covers it,
   so it must be a fixed value, not a floating "now").
2. `GET /.well-known/agenc-store.json` and copy the `signing.message` string.
3. Sign that message with the **owner wallet**:
   - **browser wallet:** `signMessage(new TextEncoder().encode(message))`;
   - **local file keypair:**
     ```
     node node_modules/@tetsuo-ai/store-core/scripts/manifest-sign.mjs \
       <owner-keypair.json> http://localhost:3000/.well-known/agenc-store.json
     ```
     (self-contained on `node:crypto`; local signing only, nothing broadcast —
     it re-canonicalizes the body itself and prints the `manifest:` snippet).
4. Paste the base58 `signature` into `agenc.config.ts` → `manifest`. Any later
   config change (name, fees, origin, moderation, agents, `updatedAt`, …)
   requires re-signing — the route **fails closed** on a stale signature.

## Resolved ambiguities (where the spec was silent)

- **Canonicalization algorithm.** The spec says "sorted-key JSON, the
  `canonicalStoreClaimPayload` discipline" but does not pin the sort order or
  optional-field handling byte-for-byte. Resolved to the repo's existing
  `json-stable-v1` (SDK `values.canonicalJobSpecJson`): recursive
  `Object.keys().sort()`, drop `undefined`, omit absent optionals (never
  `null`). The committed vectors pin the exact bytes.
- **Signature encoding.** The spec names ed25519 detached but not the string
  encoding. Resolved to **base58** (matching Solana pubkeys/signatures; agenc.ag
  uses base64 for its *claim* route, but base58 keeps the whole manifest in one
  encoding). Verifiers decode base58 and require exactly 64 bytes.
- **`updatedAt` unit.** Resolved to **unix seconds** (integer), and made
  mandatory once a signature is configured so the signed value is reproducible.
- **`origin` shape.** Resolved to `""` or an exact `new URL(x).origin`
  (scheme + host + non-default port, no path, no trailing slash), rejecting
  `https://x.com/` so the fetch-origin comparison is unambiguous.
