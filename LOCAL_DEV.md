# Local development

The two upstream `@tetsuo-ai` packages this repo consumes are registry
dependencies on the coordinated revision-5 release lines:

- `@tetsuo-ai/marketplace-sdk` `^0.12.0`
- `@tetsuo-ai/marketplace-react` `^0.5.0`

Revision 5 is a flag-day wire change: pre-0.12 SDKs and pre-0.5 React clients
must not be used after the program cutover. Until these exact versions are
published as part of the coordinated release, validate with the packed-artifact
workflow below; a clean registry install is a post-publication release gate.

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
npm ls @tetsuo-ai/marketplace-sdk                # must show 0.12.x from the registry
npm ls @tetsuo-ai/marketplace-react              # must show 0.5.x from the registry
npm run typecheck && npm run build
```

After the coordinated release, a plain install in `my-store` resolves
`@tetsuo-ai/store-core` from npm. While the staged store-core version is not yet
published, pack it too and co-install BOTH tarballs in ONE command at BOTH
install points (the CLI host dir and the scaffolded store) — installing the CLI
tarball alone then fails with ETARGET:

```bash
npm pack --workspace @tetsuo-ai/store-core
npm i /path/to/tetsuo-ai-store-core-*.tgz /path/to/create-agenc-store-*.tgz
# and in my-store, BEFORE npm install:
npm i /path/to/tetsuo-ai-store-core-*.tgz
```
