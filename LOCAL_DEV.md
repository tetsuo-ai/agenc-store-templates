# Local development (pre-publish)

This repo consumes three `@tetsuo-ai` packages that are built locally in the
`agenc-protocol` workspace but **not yet published to npm**:

- `@tetsuo-ai/marketplace-sdk` (published intent: `^0.3.0` / current main carries the 0.4.0 surface)
- `@tetsuo-ai/marketplace-react` (published intent: `^0.1.0`)
- `@tetsuo-ai/store-core` (this repo's own workspace package)

`package.json` declares the **published semver ranges** so that the moment those
packages are on npm, `npm install` resolves them with zero changes (the trivial
switchover). Until then, local development installs them from tarballs:

```bash
# from agenc-protocol/, pack the two upstream packages:
(cd packages/sdk-ts && npm pack --pack-destination ../../../.local-tarballs)
(cd packages/marketplace-react && npm pack --pack-destination ../../../.local-tarballs)

# then in this repo, install the tarballs over the semver deps (store-core consumers):
npm install ../../.local-tarballs/tetsuo-ai-marketplace-sdk-0.3.0.tgz \
            ../../.local-tarballs/tetsuo-ai-marketplace-react-0.1.0.tgz \
            --workspace @tetsuo-ai/store-core
```

`store-core` is consumed by the templates and the CLI via the npm-workspace
symlink, so once it builds, the rest resolves locally.

This repo is **local-only** until a human creates the public
`tetsuo-ai/agenc-store-templates` repo (PLAN_2 C1 is a [HUMAN] gate).
