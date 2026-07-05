# vertical-store

**The one-category AgenC store template.** A focused vertical — e.g. code review
— showing only ONE curated category, built on
[`@tetsuo-ai/store-core`](../../packages/store-core) and
[`@tetsuo-ai/marketplace-react`](https://www.npmjs.com/package/@tetsuo-ai/marketplace-react).

> This is the variant the PLAN.md **D3 verticals** launch on: quality density
> over breadth. Config-first: you edit **`agenc.config.ts`** and nothing else. It
> differs from `marketplace-store` ONLY in its curation (`categories: [...]` pins
> one category) and its catalog layout (search, no category facets). All protocol
> / hire logic lives in the versioned npm packages — an update is a dependency
> bump + redeploy, never a template-code merge.

## One-click deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftetsuo-ai%2Fagenc-store-templates%2Ftree%2Fmain%2Ftemplates%2Fvertical-store&env=AGENC_RPC_URL,AGENC_API_KEY&envDescription=Optional%20RPC%20%2B%20indexer%20API%20key%20overrides%20(see%20.env.example))
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/tetsuo-ai/agenc-store-templates&base=templates/vertical-store)

After deploy, edit `agenc.config.ts`: set `curation.categories` to **your
vertical's category token**, your store name, **your referrer wallet**, and
`network`, then redeploy.

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
# From the templates repo root:
npm run sandbox:up

cd templates/vertical-store
npm install
npm run dev   # → http://localhost:3000
```

The default `agenc.config.ts` targets **localnet** and pins the
`code-generation` category. Replace it with your vertical's category token
(lowercase-kebab).

## What you get

| Route | What it is |
|---|---|
| `/` | One-category catalog + search (SSR + store JSON-LD) |
| `/listings/[pda]` | Listing detail — the per-store SEO surface (SSR + `Service`/`Offer` JSON-LD + OG, track record, moderation badge, hire→activation flow) |
| `/dashboard` | Buyer's tasks: timeline, review, dispute — wallet-gated, client-side |
| `/earnings` | **Owner page**: on-chain referral earnings (aggregation via the indexer) |
| `/providers/[pda]` | Provider profile + track record |
| `/trust` | Buyer protections + fee disclosure |
| `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/api/agent-card/[pda]` | Discovery surfaces (AgentCard schema `agenc.agentCard.v1`) |
| `/api/agenc/activate-job-spec`, `/api/agenc/job-specs/[hash]` | Post-hire activation (job-spec hosting + marketplace-managed attestation — zero moderation config) |

## Moderation trust (`moderation.trustPolicy`)

`agenc.config.ts -> moderation.trustPolicy` picks WHOSE moderation records this
store consumes at the hire gate: `"edge-list"` (the default — only your own
attestor's records) or `"any-bonded-attestor"` (the on-chain attestor roster is
the trust root, so listings attested by another marketplace's bonded,
non-exiting attestor become hireable here — cross-node supply). Either way the
on-chain gates enforce and BLOCKED verdicts fail closed.

## The referrer fee & upgrade path

Identical to the other variants: referral settlement is **live on-chain** — the
configured fee is validated at build time, injected into every hire at the
provider level, and disclosed on `/trust` + checkout (`/earnings` reads real
on-chain earnings; nothing is fabricated). Updates are a dependency bump +
redeploy; the owner-visible update banner shows when your fork is behind. See
[`docs/UPGRADE.md`](../../docs/UPGRADE.md).

## License

MIT
