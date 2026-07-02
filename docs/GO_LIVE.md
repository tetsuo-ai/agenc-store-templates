# Mainnet go-live checklist (the `allowMainnet: true` gate)

`network: "mainnet"` points your store at **real funds**. The config schema
refuses to build until you set the deliberate opt-in:

```ts
// agenc.config.ts
export default defineStore({
  network: "mainnet",
  allowMainnet: true, // ← the explicit real-funds opt-in
  // ...
});
```

Set it only after walking this checklist. The machine-checkable half is
available in code — render it in a boot script or CI step:

```ts
import { checkMainnetGoLive } from "@tetsuo-ai/store-core/config";

const { ready, checks } = checkMainnetGoLive(storeConfig);
```

## The checklist

1. **Deliberate opt-in** — `allowMainnet: true` is set by a human who read this
   file. Never scripted, never defaulted (`create-agenc-store` refuses to emit
   it without `--allow-mainnet`).
2. **Production read path** — `api.baseUrl` points at an HTTPS indexer, or
   `AGENC_RPC_URL` is set to a production HTTPS RPC. A localhost read path can
   never serve a real-funds store.
3. **Public HTTPS `seo.siteUrl`** — checkout job-spec pointers pinned
   **on-chain** (`/api/agenc/job-specs/[hash]`) derive from it; a localhost
   siteUrl would pin unreachable URIs.
4. **Referrer wallet** — `referrer.wallet` is YOUR wallet (base58 is validated
   at build time). Referral settlement is live on-chain: every hire pays this
   wallet its fee atomically, so a wrong wallet is lost revenue.
5. **Env hygiene** — `.env` values (`AGENC_RPC_URL`, `AGENC_API_KEY`) are set
   in your host's env settings, not committed.
6. **Persistent job-spec hosting** — the default activation route hosts
   canonical job-spec JSON on the app filesystem (`.agenc/job-specs`). On a
   VPS/container with a persistent disk this works as-is; on ephemeral
   serverless hosts, mount persistent storage or swap the `storeJobSpec` seam
   in `src/app/api/agenc/activate-job-spec/route.ts` for your object store.
   The pinned on-chain hash keeps every hosted document verifiable regardless
   of where it lives.

## What is deliberately NOT on this checklist

**Moderation setup.** There is none. The hire→activation flow requests its
task-moderation attestation from the marketplace-managed attestation service
automatically — zero configuration, no token, no signup (the
invisible-by-default rule). Running your own attestor is a sovereignty
*option*, not a prerequisite: set `moderation.attestorEndpoint` in
`agenc.config.ts` only if you operate one.
