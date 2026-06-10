# @tetsuo-ai/store-core

The shared package every [AgenC store template](../../README.md) consumes
(PLAN_2 Part C). **All protocol/hire logic lives here and in
[`@tetsuo-ai/marketplace-react`](https://www.npmjs.com/package/@tetsuo-ai/marketplace-react)**;
template code is layout + config ONLY. That architecture rule is what makes an
instance update a dependency bump + redeploy (PLAN_2 C7), never a template-code
merge — so keep new protocol logic here, not in templates.

## Public surface

Each area is also a tree-shakeable subpath export.

### `config` — the single configuration surface (C2)

```ts
import { defineStore } from "@tetsuo-ai/store-core";

export default defineStore({
  name: "Acme Agent Store",
  description: "Hire vetted agents for code review.",
  network: "localnet", // "localnet" | "devnet" | "mainnet"
  api: { baseUrl: "https://indexer.example.com" },
  referrer: { wallet: "<base58>", feeBps: 250 },
  branding: { poweredBy: true },
  seo: { siteUrl: "https://store.example.com" },
});
```

- `defineStore(config)` / `safeDefineStore(config)` — validate + normalize. A
  misconfig throws `StoreConfigError` whose message lists every problem with its
  field path. **Build-time validation**:
  - `referrer.wallet` MUST be base58 (a wrong wallet would silently drop the
    owner's fees → hard error);
  - `referrer.feeBps` is range-checked against the combined cap
    `REFERRER_COMBINED_FEE_BPS_CAP` (protocol + operator + referrer ≤ 4000 bps);
  - `network: "mainnet"` fails until Phase 9 unless `allowMainnet: true`;
  - reserved payment flags (`embedded`/`fiat`/`x402`) fail closed until wired.
- `getDeployedSurface(config, probe)` / `SurfaceNotDeployedError` — render an
  explicit "listings not live yet" page instead of an empty grid.
- `checkCombinedFee(...)` — per-listing combined-fee pre-check so the checkout
  surfaces a clear error BEFORE building a transaction that would revert.
- `applyCuration(...)` / `curationToListingsFilter(...)` — curation logic.

### `seo` — the SEO surface (C3)

`listingJsonLd` / `storeJsonLd` (schema.org Service/Offer), `storeMetadata` /
`listingMetadata` (OG/canonical), `buildSitemapEntries` / `renderSitemapXml` /
`buildRobotsTxt`, `listingAgentCard` / `buildLlmsTxt`, and `storeSeoContext`.

### `sections` — the shared page components (C3)

`StoreShell`, `CatalogSection`, `ListingDetailSection`, `DashboardTaskSection`,
`EarningsSection` (the owner `/earnings` view), `TrustSection`, and the specced
empty/error states (`SurfaceNotDeployedSection`, `EmptyCatalogSection`,
`ZeroMatchSection`, `IndexerUnreachableSection`). Each wraps
`marketplace-react`, so all three templates differ only in routing + curation.

### `upgrade` — instance-upgrade primitives (C7)

`checkStaleness`, `useChangelogFeed`, and `<UpdateBanner>` (owner-visible;
security updates flagged).

### `@tetsuo-ai/store-core/sandbox-up`

The committed deterministic local-validator bootstrap. It reuses the
`agenc-protocol` localnet stack (set `AGENC_PROTOCOL_DIR`, or place
`agenc-protocol` as a workspace sibling) so template CI runs against exactly the
on-chain state the protocol + SDK are tested against.

```bash
node scripts/sandbox-up.mjs up    # boot + init + seed (idempotent)
node scripts/sandbox-up.mjs env   # print the resolved sandbox env JSON
node scripts/sandbox-up.mjs down  # stop the validator
```

## The P6.2 referrer gate

Referrer config is validated + stored + disclosed, but **never injected** and
**never fabricated as earnings**. `marketplace-react`'s
`resolveReferrerCapability()` returns `{ live: false }` until the on-chain
referrer settlement leg (PLAN.md P6.2) ships; `EarningsSection` renders that
not-live state honestly.

## License

MIT
