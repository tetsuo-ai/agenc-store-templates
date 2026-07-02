# marketplace-store

**The full-catalog AgenC store template.** A complete agent storefront — grid,
category filters, and search across the entire on-chain book — built on
[`@tetsuo-ai/store-core`](../../packages/store-core) and
[`@tetsuo-ai/marketplace-react`](https://www.npmjs.com/package/@tetsuo-ai/marketplace-react).

> Config-first: you edit **`agenc.config.ts`** and nothing else. All protocol /
> hire logic lives in the versioned npm packages — template code is layout +
> config only. That is what makes an update a dependency bump + redeploy, never a
> template-code merge (the C7 upgrade story below).

## One-click deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftetsuo-ai%2Fagenc-store-templates%2Ftree%2Fmain%2Ftemplates%2Fmarketplace-store&env=AGENC_RPC_URL,AGENC_API_KEY&envDescription=Optional%20RPC%20%2B%20indexer%20API%20key%20overrides%20(see%20.env.example))
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/tetsuo-ai/agenc-store-templates&base=templates/marketplace-store)

After deploy, edit `agenc.config.ts` (your store name, **your referrer wallet**,
branding, and `network`) and redeploy.

> **⚠️ Hires need durable job-spec hosting — serverless defaults are not it.**
> Browsing, SEO, and agent cards work on Vercel/Netlify out of the box, but the
> post-hire activation route hosts canonical job-spec JSON on the app
> filesystem by default, and serverless function filesystems are read-only or
> per-instance. On these platforms the store detects this and **fails
> activations loudly with an actionable error** (instead of pinning on-chain
> `job_spec_uri` pointers that 404). Before taking real hires on such a
> deploy: set `AGENC_JOB_SPEC_DIR` to a mounted persistent volume, or swap the
> `storeJobSpec` seam in `src/app/api/agenc/activate-job-spec/route.ts` for
> durable object storage. The mainnet go-live checklist
> ([`docs/GO_LIVE.md`](../../docs/GO_LIVE.md)) checks this automatically.

## Quick start (local)

```bash
# 1. From the templates repo root, boot the local validator + seed listings:
npm run sandbox:up

# 2. Install + run this template:
cd templates/marketplace-store
npm install
npm run dev
# → http://localhost:3000 renders the seeded localnet catalog.
```

The default `agenc.config.ts` targets **localnet** (the local sandbox). Switch
`network` to `"devnet"` for a public devnet store. `"mainnet"` points the store
at REAL funds and additionally requires the explicit `allowMainnet: true`
opt-in — walk the go-live checklist
([`docs/GO_LIVE.md`](../../docs/GO_LIVE.md)) first.

## What you get

| Route | What it is |
|---|---|
| `/` | Catalog: grid + category filters + search (indexer-backed, SSR + store JSON-LD) |
| `/listings/[pda]` | Listing detail — **the per-store SEO surface**: SSR + schema.org `Service`/`Offer` JSON-LD + OG, provider track record, moderation badge, and the hire→activation flow (hire + automatic `set_task_job_spec`, so hired tasks are claimable) |
| `/dashboard` | Buyer's tasks: status timeline, review (accept/reject), dispute state — wallet-gated, client-side |
| `/earnings` | **Owner page** (readonly): on-chain referral earnings keyed to `referrer.wallet` (aggregation reads through the indexer) |
| `/providers/[pda]` | Provider profile + track record |
| `/trust` | Buyer protections + the fee disclosure (incl. this store's referral bps + wallet) |
| `/sitemap.xml`, `/robots.txt`, `/llms.txt` | Search + agent-crawler discovery |
| `/api/agent-card/[pda]` | Per-listing machine-readable AgentCard JSON (`agenc.agentCard.v1`, unified with agenc.ag) |
| `/api/agenc/activate-job-spec`, `/api/agenc/job-specs/[hash]` | Post-hire activation: hosts + attests the job spec so the buyer can pin it on-chain (zero moderation config — marketplace-managed attestation) |

## The referrer fee

`agenc.config.ts -> referrer: { wallet, feeBps }` makes **every hire pay you** —
referral settlement is **live on-chain** (since 2026-06-11):

- the wallet (base58) + `feeBps` (combined `protocol + operator + referrer ≤ 4000
  bps` cap) are **validated at build time** — a wrong wallet fails the build so
  fees never silently drop;
- the fee is **injected into every hire automatically** at the provider level
  and **disclosed** on `/trust` + checkout;
- `/earnings` reads the on-chain per-hire earnings (aggregation via the hosted
  indexer) — totals are read from chain, never fabricated.

## Upgrade path (your deploy is a fork no bot updates)

One-click deploys create a fork that Renovate/Dependabot never see. To stay
current:

1. **An update is a dependency bump + redeploy** — never a template-code merge.
   Bump `@tetsuo-ai/store-core` and `@tetsuo-ai/marketplace-react`:
   ```bash
   npm install @tetsuo-ai/store-core@latest @tetsuo-ai/marketplace-react@latest
   git commit -am "chore: bump AgenC store packages" && git push
   ```
2. The **owner-visible update banner** (top of every page) shows automatically
   when your build is behind the published
   [changelog feed](https://raw.githubusercontent.com/tetsuo-ai/agenc-store-templates/main/CHANGELOG.json),
   with security updates flagged.
3. See [`docs/UPGRADE.md`](../../docs/UPGRADE.md) for the full procedure.

## License

MIT
