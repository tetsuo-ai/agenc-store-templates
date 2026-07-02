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
6. **Durable job-spec hosting** (machine-checked as `job-spec-hosting`) — the
   default activation route hosts canonical job-spec JSON on the app
   filesystem (`.agenc/job-specs`), and the URI it returns is **pinned
   on-chain** — so the hosting must outlive the request. On a VPS/container
   with a persistent disk this works as-is. On serverless platforms
   (Vercel/Netlify/Lambda/Cloud Run/Cloudflare Pages — detected from their env
   markers) the function filesystem is read-only or per-instance, so the store
   **fails every activation loudly with an actionable error** rather than
   pinning `job_spec_uri` pointers that 404. Fix it one of two ways:
   - set `AGENC_JOB_SPEC_DIR` to a mounted persistent volume (both the
     activation route and the serving route honor it), or
   - swap the `storeJobSpec` seam in
     `src/app/api/agenc/activate-job-spec/route.ts` for your object store.
   For belt-and-braces deploy tooling, `probeJobSpecHostingDurability(dir)`
   (from `@tetsuo-ai/store-core/activation/server`) runs a write+readback
   probe against the resolved directory. The pinned on-chain hash keeps every
   hosted document verifiable regardless of where it lives.

## What is deliberately NOT on this checklist

**Moderation setup.** There is none. The hire→activation flow requests its
task-moderation attestation from the marketplace-managed attestation service
automatically — zero configuration, no token, no signup (the
invisible-by-default rule). Running your own attestor is a sovereignty
*option*, not a prerequisite: set `moderation.attestorEndpoint` in
`agenc.config.ts` only if you operate one.
