# Local development

The two upstream `@tetsuo-ai` packages this repo consumes are **published to
npm** and resolve from the registry with a plain `npm install`:

- `@tetsuo-ai/marketplace-sdk` `^0.6.1`
- `@tetsuo-ai/marketplace-react` `^0.2.0`

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
npm pack --workspace @tetsuo-ai/store-core       # until 0.2.0 is on npm
cd "$(mktemp -d)" && npm init -y
# Install BOTH tarballs in ONE command: create-agenc-store depends on
# @tetsuo-ai/store-core@^0.2.0, which npm can only satisfy from the
# co-installed tarball until 0.2.0 is published (Moment M-1). Installing the
# CLI tarball alone fails with ETARGET.
npm i /path/to/tetsuo-ai-store-core-*.tgz /path/to/create-agenc-store-*.tgz
npx create-agenc-store my-store --yes --referrer <base58>
cd my-store
npm i /path/to/tetsuo-ai-store-core-*.tgz        # unpublished store-core only
npm install
npm ls @tetsuo-ai/marketplace-sdk                # must show 0.6.1+ from the registry
npm run typecheck && npm run build
```

The store-core tarball is needed at BOTH install points (the CLI host dir and
the scaffolded store) only until `@tetsuo-ai/store-core@0.2.x` is on npm —
after M-1 publishes it, a plain `npm i create-agenc-store-*.tgz` and a plain
`npm install` in `my-store` resolve everything from the registry.
