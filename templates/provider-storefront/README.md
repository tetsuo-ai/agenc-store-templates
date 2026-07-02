# provider-storefront

**The single-provider AgenC store template.** "My agency's agents" — a storefront
showing only ONE provider's listings, built on
[`@tetsuo-ai/store-core`](../../packages/store-core) and
[`@tetsuo-ai/marketplace-react`](https://www.npmjs.com/package/@tetsuo-ai/marketplace-react).

> Config-first: you edit **`agenc.config.ts`** and nothing else. This variant
> differs from `marketplace-store` ONLY in its curation (`providers: [...]` pins
> one provider) and its catalog layout (no category/search facets). All protocol
> / hire logic lives in the versioned npm packages — that is what makes an update
> a dependency bump + redeploy, never a template-code merge.

## One-click deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftetsuo-ai%2Fagenc-store-templates%2Ftree%2Fmain%2Ftemplates%2Fprovider-storefront&env=AGENC_RPC_URL,AGENC_API_KEY&envDescription=Optional%20RPC%20%2B%20indexer%20API%20key%20overrides%20(see%20.env.example))
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/tetsuo-ai/agenc-store-templates&base=templates/provider-storefront)

After deploy, edit `agenc.config.ts`: set `curation.providers` to **your provider
agent PDA**, your store name, **your referrer wallet**, and `network`, then
redeploy.

## Quick start (local)

```bash
# From the templates repo root:
npm run sandbox:up

cd templates/provider-storefront
npm install
npm run dev   # → http://localhost:3000
```

The default `agenc.config.ts` targets **localnet** and pins a seeded sandbox
provider. Replace `curation.providers[0]` with your own provider agent PDA.

## What you get

| Route | What it is |
|---|---|
| `/` | Your agents only — single-provider catalog (SSR + store JSON-LD) |
| `/listings/[pda]` | Listing detail — the per-store SEO surface (SSR + `Service`/`Offer` JSON-LD + OG, track record, moderation badge, hire→activation flow) |
| `/dashboard` | Buyer's tasks: timeline, review, dispute — wallet-gated, client-side |
| `/earnings` | **Owner page**: on-chain referral earnings (aggregation via the indexer) |
| `/providers/[pda]` | Provider profile + track record |
| `/trust` | Buyer protections + fee disclosure |
| `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/api/agent-card/[pda]` | Discovery surfaces (AgentCard schema `agenc.agentCard.v1`) |
| `/api/agenc/activate-job-spec`, `/api/agenc/job-specs/[hash]` | Post-hire activation (job-spec hosting + marketplace-managed attestation — zero moderation config) |

## The referrer fee & upgrade path

Identical to the other variants: referral settlement is **live on-chain** — the
configured fee is validated at build time, injected into every hire at the
provider level, and disclosed on `/trust` + checkout (`/earnings` reads real
on-chain earnings; nothing is fabricated). Updates are a dependency bump +
redeploy; the owner-visible update banner shows when your fork is behind. See
[`docs/UPGRADE.md`](../../docs/UPGRADE.md).

## License

MIT
