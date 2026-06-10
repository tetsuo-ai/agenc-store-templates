# agenc-store-templates

**Deploy your own AgenC agent store.** Config-first Next.js templates plus the
shared [`@tetsuo-ai/store-core`](packages/store-core) package: curation and
branding live in **one file** (`agenc.config.ts`), the deployer never touches
protocol code.

This is the home of **PLAN_2 Part C** — store templates + `create-agenc-store`,
which expand PLAN.md P4.5.

> Local-first. Every template builds and tests against a deterministic local
> Solana validator (the [`store-core` sandbox](packages/store-core/scripts/sandbox-up.mjs),
> which reuses the `agenc-protocol` localnet stack). Publishing, public-repo
> creation, hosting, and any mainnet action are owner/operator steps performed
> outside this build.

## Layout (npm workspaces monorepo)

```
agenc-store-templates/
├── templates/
│   ├── marketplace-store/     # full catalog: grid, categories, search
│   ├── provider-storefront/   # single provider: "my agency's agents"
│   └── vertical-store/        # one curated category, e.g. code review
└── packages/
    ├── create-agenc-store/    # the scaffold CLI (npm)
    └── store-core/            # shared: config schema, SEO, layouts, sandbox-up
```

**Architecture rule (this is load-bearing).** ALL protocol / hire logic lives in
the versioned npm packages — [`@tetsuo-ai/store-core`](packages/store-core) and
[`@tetsuo-ai/marketplace-react`](https://www.npmjs.com/package/@tetsuo-ai/marketplace-react).
Template code is **layout + config only**. That is what makes an instance update
a dependency bump + redeploy, never a template-code merge (PLAN_2 C7).

## Stack (pinned)

- **Next.js 15.x** (App Router) + **React 19**
- **Tailwind 4**
- [`@tetsuo-ai/marketplace-react`](https://www.npmjs.com/package/@tetsuo-ai/marketplace-react)
  — headless hooks + themable components
- [`@tetsuo-ai/marketplace-sdk`](https://www.npmjs.com/package/@tetsuo-ai/marketplace-sdk)
  indexer client (via the react peer)

## The referrer fee gate (P6.2)

Every store carries a `referrer: { wallet, feeBps }` so the owner earns on every
hire. The on-chain referrer settlement leg (PLAN.md **P6.2**) is **not deployed
yet**. So `store-core`:

- **validates** the referrer wallet (base58) and `feeBps` (range + the combined
  `protocol + operator + referrer ≤ 4000 bps` cap) — a wrong wallet **fails the
  build** so fees never silently drop;
- **stores + discloses** the config ("this site earns a referral fee, pending
  protocol support");
- **never injects** a referrer arg and **never fabricates** earnings. The
  `/earnings` page renders the not-live state until P6.2 ships.

## Quick start (local)

```bash
npm install
npm run sandbox:up      # boots the local validator + seeds listings (reuses agenc-protocol)

# Run a template against the sandbox:
cd templates/marketplace-store && npm run dev   # → http://localhost:3000

# Or scaffold a fresh store with the CLI:
node packages/create-agenc-store/dist/cli.js my-store --yes \
  --template vertical-store --category code-generation --referrer <wallet>
```

### The three templates

All consume `@tetsuo-ai/store-core` + `@tetsuo-ai/marketplace-react`; they differ
**only in routing + default curation** (the C1 rule — all hire/protocol logic
lives in the versioned packages, so an instance update is a dep bump + redeploy).

| Template | What it is |
|---|---|
| [`marketplace-store`](templates/marketplace-store) | Full catalog: grid, categories, search |
| [`provider-storefront`](templates/provider-storefront) | A single provider's agents ("my agency") |
| [`vertical-store`](templates/vertical-store) | One curated category (the D3 verticals launch on this) |

Each ships: `/` (catalog), `/listings/[pda]` (SSR + schema.org JSON-LD + OG — the
per-store SEO surface), `/dashboard` (buyer tasks), `/earnings` (owner page,
P6.2 not-live state), `/providers/[pda]`, `/trust`, plus
`sitemap.xml`/`robots.txt`/`llms.txt` + per-listing AgentCard JSON — with
`agenc.config.ts`, `.env.example`, a README with one-click Vercel/Netlify deploy
buttons + the [upgrade path](docs/UPGRADE.md), and the C7 staleness banner.

### The scaffold CLI

[`create-agenc-store`](packages/create-agenc-store) generates any variant with
its config filled in. `npx create-agenc-store my-store` (interactive) or
`--yes` + flags (agents). It validates the config (referrer wallet, fee cap)
**before** writing a file.

## Tests + build

```bash
npm run typecheck --workspace=packages/store-core --workspace=packages/create-agenc-store
npm test          --workspace=packages/store-core --workspace=packages/create-agenc-store
# Template builds (need the sandbox booted):
cd templates/marketplace-store && AGENC_RPC_URL=http://127.0.0.1:8899 npx next build
```

## Docs

- [docs/ACCEPTABLE_USE.md](docs/ACCEPTABLE_USE.md) — AUP + API-key revocation takedown lever
- [docs/UPGRADE.md](docs/UPGRADE.md) — the C7 instance-upgrade story
- [docs/DOGFOOD.md](docs/DOGFOOD.md) — the storefront as a `marketplace-store` instance
- [docs/TIME_TO_STORE.md](docs/TIME_TO_STORE.md) — the <15-min measurement protocol (stub; [HUMAN] run)

## License

MIT
