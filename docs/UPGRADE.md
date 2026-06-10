# Upgrading a deployed store (PLAN_2 C7)

A one-click deploy (or a `create-agenc-store` scaffold) produces a **fork that no
bot updates** — Renovate/Dependabot never see it. This guide is how a deployed
store stays current.

## The one rule that makes this easy

**All protocol / hire logic lives in the versioned npm packages**
(`@tetsuo-ai/store-core`, `@tetsuo-ai/marketplace-react`). Your template code is
**layout + config only**. So an update is:

> **bump the two packages + redeploy** — never a template-code merge.

This is the C1 architecture rule, and it is what makes C7 possible. If you have
edited the page wiring under `src/`, an update may still be a dep bump — but keep
your edits to layout/branding so you never diverge from the shared logic.

## How to update

```bash
# In your deployed store's repo:
npm install @tetsuo-ai/store-core@latest @tetsuo-ai/marketplace-react@latest
npm run build        # confirm it still builds
git commit -am "chore: bump AgenC store packages"
git push             # your host (Vercel/Netlify) redeploys
```

That's the whole upgrade path within this plan's horizon — including the Phase 9
devnet→mainnet flip and any checkout security fix.

## How you'll KNOW you're behind

You don't have to watch for releases. Every page renders an **owner-visible
update banner** (top of the layout) when your build is behind:

- it compares your build's pinned `store-core` version against the published
  [changelog feed](https://raw.githubusercontent.com/tetsuo-ai/agenc-store-templates/main/CHANGELOG.json);
- **security updates are flagged conspicuously** (a red banner + a "Security
  update available" headline);
- the banner links to the changelog so you can read what changed.

The banner is wired in every template at `src/lib/update-banner.tsx` (via
`store-core/upgrade`'s `useChangelogFeed` + `<UpdateBanner>`). It is owner-facing
chrome — it makes no network request during SSR, only after the page hydrates.

## The changelog feed

The feed is `CHANGELOG.json` at the repo root, schema
`agenc.store-changelog/v1`:

```json
{
  "schema": "agenc.store-changelog/v1",
  "entries": [
    { "version": "0.1.0", "date": "2026-06-10", "summary": "…", "security": false }
  ]
}
```

Entries are newest-first; the banner treats the first entry's `version` as
current and any entry with `"security": true` as a security release.

## Verifying the upgrade story (CI)

The repo's tests assert the staleness logic so the banner can never silently
stop firing:

- a deliberately-outdated installed version vs a newer feed version →
  `checkStaleness(...).stale === true`;
- a security release between installed and current → `security: true`.

These live in `store-core`'s upgrade tests and are exercised structurally; the
templates consume the same `checkStaleness` / `<UpdateBanner>` so a regression
fails CI before it reaches a deployed store.
