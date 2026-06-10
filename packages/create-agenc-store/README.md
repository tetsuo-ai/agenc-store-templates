# create-agenc-store

Scaffold a **deploy-your-own AgenC agent store** in one command (PLAN_2 C4).

```bash
npx create-agenc-store my-store
```

Interactive by default; fully flag-driven for non-interactive / agent use.

## What it does

1. Prompts for (or takes as flags): template variant, store name, network,
   referrer wallet, branding basics, and the per-variant curation key.
2. **Validates** the config with `@tetsuo-ai/store-core` BEFORE writing a single
   file — a bad referrer wallet (base58) or an over-cap fee FAILS up front, so
   fees never silently drop.
3. Generates the app with `agenc.config.ts` filled in, `.env.example`, and the
   README with one-click deploy buttons.

Then: `cd my-store && npm install && npm run dev` → a working store against the
local sandbox in under five minutes.

## Variants

| `--template` | What it is |
|---|---|
| `marketplace-store` (default) | Full catalog: grid, categories, search |
| `provider-storefront` | A single provider's agents ("my agency") — needs `--provider <pda>` |
| `vertical-store` | One curated category — needs `--category <token>` (the D3 verticals launch on this) |

## Non-interactive (agents)

```bash
npx create-agenc-store code-shop --yes \
  --template vertical-store \
  --category code-generation \
  --referrer <your-base58-wallet> \
  --network localnet \
  --name "Code Shop"
```

Run `npx create-agenc-store --help` for the full flag list.

## The referrer fee (P6.2 gate)

The `--referrer` wallet earns on every hire — once PLAN.md **P6.2** (referral
settlement) is live on-chain. Until then the fee is validated, stored, and
disclosed but **never injected or fabricated**; the scaffolded store's
`/earnings` page renders the not-live state.

## License

MIT
