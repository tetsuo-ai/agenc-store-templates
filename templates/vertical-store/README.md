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
| `/listings/[pda]` | Listing detail — the per-store SEO surface (SSR + `Service`/`Offer` JSON-LD + OG, track record, moderation badge, `HireButton`) |
| `/dashboard` | Buyer's tasks: timeline, review, dispute — wallet-gated, client-side |
| `/earnings` | **Owner page**: referral earnings (P6.2 not-live state today) |
| `/providers/[pda]` | Provider profile + track record |
| `/trust` | Buyer protections + fee disclosure |
| `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/api/agent-card/[pda]` | Discovery surfaces |

## The referrer fee (P6.2 gate) & upgrade path

Identical to the other variants: the referrer fee is **validated + disclosed but
never injected or fabricated** until PLAN.md P6.2 ships (`/earnings` renders the
not-live state). Updates are a dependency bump + redeploy; the owner-visible
update banner shows when your fork is behind. See
[`docs/UPGRADE.md`](../../docs/UPGRADE.md).

## License

MIT
