# Local development

The two upstream `@tetsuo-ai` packages this repo consumes are **published to
npm** and resolve from the registry with a plain `npm install`:

- `@tetsuo-ai/marketplace-sdk` `^0.7.0`
- `@tetsuo-ai/marketplace-react` `^0.3.0`

(0.7.0/0.3.0 are the A1 cutover versions — sdk 0.6.x / react 0.2.x builds are
rejected fail-closed by the mainnet program since the 2026-07-02 roster-gate
upgrade.)

Never reintroduce `file:` overrides or `.local-tarballs/` pins for these — a
root `overrides` block silently defeats every future pin bump and breaks
installs on any other machine (that booby-trap was removed in WP-B1).

`@tetsuo-ai/store-core` is this repo's own workspace package: the templates and
the CLI consume it via the npm-workspace symlink, so `npm run build -w
@tetsuo-ai/store-core` is all that's needed before template typechecks/builds.

## Testing an UNPUBLISHED upstream version

When you need to validate against a not-yet-published sdk/react build, pack it
from the `agenc-protocol` checkout and install the tarball **into the specific
workspace** (never as a root override):

```bash
# from agenc-protocol/:
(cd packages/sdk-ts && npm pack --pack-destination /tmp)
# then here:
npm install /tmp/tetsuo-ai-marketplace-sdk-<ver>.tgz --workspace @tetsuo-ai/store-core
```

Revert `package.json` to the registry semver range before committing.

## Clean-room scaffold check

The release gate for `create-agenc-store` is a clean-room scaffold from a
packed tarball:

```bash
npm pack --workspace create-agenc-store          # runs prepack (bundles templates)
cd "$(mktemp -d)" && npm init -y
npm i /path/to/create-agenc-store-*.tgz
npx create-agenc-store my-store --yes --referrer <base58>
cd my-store
npm install
npm ls @tetsuo-ai/marketplace-sdk                # must show 0.7.0+ from the registry
npm run typecheck && npm run build
```

`@tetsuo-ai/store-core` is on npm, so a plain install in `my-store` resolves
everything from the registry. When the release bumps store-core itself (its
new version is not yet published), pack it too and co-install BOTH tarballs in
ONE command at BOTH install points (the CLI host dir and the scaffolded
store) — installing the CLI tarball alone then fails with ETARGET:

```bash
npm pack --workspace @tetsuo-ai/store-core
npm i /path/to/tetsuo-ai-store-core-*.tgz /path/to/create-agenc-store-*.tgz
# and in my-store, BEFORE npm install:
npm i /path/to/tetsuo-ai-store-core-*.tgz
```
