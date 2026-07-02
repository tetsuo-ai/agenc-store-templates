# Dogfooding: the storefront as a `marketplace-store` instance (PLAN_2 C6)

PLAN.md P10.1's goal is "the first-party storefront becomes operator #1" — i.e.
the public `agenc-services-storefront` catalog is **literally an instance of the
same `marketplace-store` template third parties deploy**, not a parallel
implementation.

> **Status: build-complete / deploy-gated.** The `marketplace-store` template IS
> the dogfood-capable artifact today — it renders the live on-chain book via the
> indexer (verified locally against the localnet sandbox). The actual swap of the
> production storefront, and its deployment, is a **[HUMAN]** step (a Vite SPA →
> Next template rebuild + deploy). This doc is the exact swap procedure.

## What's already true

`templates/marketplace-store` renders the on-chain catalog through the indexer /
gPA read path, with the full surface a storefront needs:

- `/` catalog (grid + category filters + search),
- `/listings/[pda]` detail with SSR JSON-LD + OG (the per-store SEO surface),
- `/dashboard` (buyer tasks), `/providers/[pda]`, `/trust`,
- `sitemap.xml` / `robots.txt` / `llms.txt` / per-listing AgentCard JSON.

Verified locally: `npm run sandbox:up` then `cd templates/marketplace-store &&
npm run dev` renders the seeded localnet listings (and `npm run build` succeeds
against the sandbox). The same instance against the **hosted devnet indexer** is
the storefront-equivalent — only `agenc.config.ts -> api.baseUrl` + `network`
change.

## The swap (what the storefront becomes)

`agenc-services-storefront` today is a Vite + React SPA with a file-backed
catalog. To make it an instance of `marketplace-store`:

1. **Scaffold the instance** (or copy `templates/marketplace-store`):
   ```bash
   npx create-agenc-store agenc-services-storefront \
     --template marketplace-store \
     --network devnet \
     --referrer <the-storefront-operator-wallet> \
     --api-base-url https://<hosted-indexer-base-url> \
     --site-url https://marketplace.agenc.tech \
     --name "AgenC Services" \
     --yes
   ```
2. **Carry over branding** — set `branding.logo` / `branding.colors` in
   `agenc.config.ts` to the storefront's brand. (Theme is the `--agenc-*`
   contract; no component edits.)
3. **Curation** — the first-party storefront carries the whole book, so leave
   `curation` at `{ requireModeration: true }` (the marketplace-store default).
4. **Build + verify locally** against the hosted devnet indexer:
   ```bash
   npm install && npm run build && npm run start
   ```
   Confirm the catalog, a listing detail (JSON-LD), and `/dashboard` render
   against devnet.
5. **[HUMAN] deploy** — replace the deployed Vite SPA with this Next instance
   (mainnet requires the explicit `allowMainnet: true` opt-in — see
   [GO_LIVE.md](GO_LIVE.md)). PLAN.md P10.1's steps already reference this
   instance.

## Why this is a rebuild, not a refactor

The current storefront is a Vite SPA; the template is a Next.js 15 App Router
app. The catalog/listing/dashboard UI is **fully provided by the template** (no
storefront-specific catalog code survives), but the surrounding SPA shell,
routing, and any storefront-only pages are a genuine rebuild. Scope it as such.

## Done-when (this task)

- ✅ `marketplace-store` renders the on-chain book via the indexer on localnet
  (verified locally; `next build` green against the sandbox).
- ⏸️ The production storefront swap + deploy is **[HUMAN]** (devnet now;
  mainnet behind the deliberate `allowMainnet: true` opt-in).
