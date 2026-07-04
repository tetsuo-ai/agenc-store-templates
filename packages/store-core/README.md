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
  - `network: "mainnet"` fails unless `allowMainnet: true` is set explicitly
    (the deliberate real-funds opt-in — see `docs/GO_LIVE.md` +
    `checkMainnetGoLive(...)`);
  - reserved payment flags (`embedded`/`fiat`/`x402`) fail closed until wired.
- `getDeployedSurface(config, probe)` / `SurfaceNotDeployedError` — render an
  explicit "listings not live yet" page instead of an empty grid.
- `checkCombinedFee(...)` — per-listing combined-fee pre-check so the checkout
  surfaces a clear error BEFORE building a transaction that would revert.
- `applyCuration(...)` / `curationToListingsFilter(...)` — curation logic.
- `listingOperatorTerms(config)` — the `operator`/`operatorFeeBps` pair for the
  SDK's `createServiceListing` (operator terms on listing creation).
- `checkMainnetGoLive(config)` — the machine-checkable half of the real-funds
  go-live checklist behind `allowMainnet: true`.

### `seo` — the SEO surface (C3)

`listingJsonLd` / `storeJsonLd` (schema.org Service/Offer), `storeMetadata` /
`listingMetadata` (OG/canonical), `buildSitemapEntries` / `renderSitemapXml` /
`buildRobotsTxt`, `listingAgentCard` / `parseAgentCard` / `buildLlmsTxt`, and
`storeSeoContext`.
The AgentCard schema is **`agenc.agentCard.v1`** — unified with agenc.ag's
production agent-card route, so one crawler shape covers every AgenC surface.
The shape is defined once (WP-F4) as the JSON Schema document served at
<https://agenc.ag/schemas/agenc.agentCard.v1.json>; this package vendors a
byte-identical copy at `schemas/agenc.agentCard.v1.json`, guarded by a
byte-equality fixture test (the sharing mechanism until the two repos share a
schema package). `parseAgentCard` reads untrusted card JSON: it accepts the
unified id, plus — deprecated, through 0.5.x only (removal: 0.6.0, per
agenc-protocol `docs/VERSIONING.md`) — the pre-unification
`agenc.agent-card/v1` shape, up-converted so callers only ever see (and
re-emit) the unified shape.

### `sections` — the shared page components (C3)

`StoreShell`, `CatalogSection`, `ListingDetailSection` (hire→activation),
`HireActivationButton`, `DashboardTaskSection`, `EarningsSection` (the owner
`/earnings` view), `TrustSection`, and the specced empty/error states
(`SurfaceNotDeployedSection`, `EmptyCatalogSection`, `ZeroMatchSection`,
`IndexerUnreachableSection`). Each wraps `marketplace-react`, so all three
templates differ only in routing + curation.

### `activation` — the hire→activation seam (WP-B1)

A hire mints a Task that workers CANNOT claim until the creator pins its job
spec (`set_task_job_spec`) behind a CLEAN task-moderation attestation. The
templates chain that automatically via `useHumanlessHireFlow`:

- `@tetsuo-ai/store-core/activation` (client-safe): `buildListingJobSpec`,
  `normalizeStoreJobSpec`, and `createStoreActivationHost` — the
  `hostAndModerateJobSpec` seam that POSTs to the store's own activation route.
- `@tetsuo-ai/store-core/activation/server` (node-only):
  `createActivateJobSpecHandler` (the route), `createFileJobSpecStore` /
  `readHostedJobSpec` (canonical-JSON hosting), the attestor seam
  (`createRemoteTaskModerationAttestor`, localnet-only
  `createLocalSandboxTaskAttestor`), and `resolveActivationBackend`.

**Invisible-by-default:** moderation attestation is never a setup step. The
route uses the marketplace-managed attestation service automatically; the only
override is the optional sovereignty field `moderation.attestorEndpoint` for
operators running their own attestor.

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

## The referrer leg

Referral settlement is **live on-chain** (deployed 2026-06-11 with the full
instruction surface). Referrer config is validated + stored + disclosed, and
`marketplace-react` injects it into every hire at the provider level
(`resolveReferrerCapability()` reports `live: true` whenever a validated
referrer is configured). Earnings are read from chain/indexer and never
fabricated — `EarningsSection` renders the hook's honest reason when the
aggregated-earnings read surface is unavailable.

## License

MIT
