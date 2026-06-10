/**
 * Instance staleness check (PLAN_2 C7). One-click deploys create forks no bot
 * updates. This compares a deployed store's pinned `store-core` version (and a
 * `surface_revision` placeholder for the P6.5 on-chain surface) against the
 * current values and reports whether the instance is behind — so a template can
 * render an OWNER-VISIBLE update banner, flagging security-relevant updates.
 *
 * Pure semver comparison; no network. The "current" side is supplied by the
 * changelog feed (see `./changelog.ts`) or pinned by the build.
 *
 * @module upgrade/staleness
 */

/** The `store-core` version this build was compiled against. */
export const STORE_CORE_VERSION = "0.1.0";

/**
 * The on-chain surface revision this build targets. A PLACEHOLDER until P6.5
 * `getDeployedSurface` exposes a real `surface_revision`; compared verbatim so
 * the flip is a value change, not a code change.
 */
export const SURFACE_REVISION = 0;

/** Parse a semver `major.minor.patch` (ignoring any prerelease) into a tuple. */
function parseSemver(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compare two semver strings. Returns -1 if `a < b`, 0 if equal (by
 * major.minor.patch), 1 if `a > b`. Unparseable inputs sort as lowest.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  return 0;
}

/** Inputs to the staleness check. */
export interface StalenessInput {
  /** The `store-core` version the deployed store was built against. */
  installedStoreCoreVersion: string;
  /** The current `store-core` version (from the changelog feed / pinned). */
  currentStoreCoreVersion: string;
  /** The surface revision the store was built against. */
  installedSurfaceRevision?: number;
  /** The current surface revision (P6.5 placeholder). */
  currentSurfaceRevision?: number;
  /**
   * Versions (current side) that carry a security fix. If the installed version
   * is below any of these, the staleness result is flagged `security: true`.
   */
  securityVersions?: string[];
}

/** The result of a staleness check. */
export interface StalenessResult {
  /** Whether the instance is behind on either dimension. */
  stale: boolean;
  /** Whether `store-core` specifically is behind. */
  storeCoreBehind: boolean;
  /** Whether the surface revision is behind. */
  surfaceBehind: boolean;
  /** Whether a behind-version crosses a flagged security release. */
  security: boolean;
  /** The installed `store-core` version (echoed for the banner copy). */
  installedStoreCoreVersion: string;
  /** The current `store-core` version (echoed for the banner copy). */
  currentStoreCoreVersion: string;
}

/**
 * Compute whether a deployed store instance is stale.
 *
 * @param input - The installed-vs-current versions + revisions.
 * @returns A {@link StalenessResult}. `stale` is true when EITHER `store-core`
 *   or the surface revision is behind; `security` is true when a behind
 *   `store-core` version is at or below a flagged security release.
 */
export function checkStaleness(input: StalenessInput): StalenessResult {
  const storeCoreBehind =
    compareSemver(
      input.installedStoreCoreVersion,
      input.currentStoreCoreVersion,
    ) < 0;

  const installedRev = input.installedSurfaceRevision ?? SURFACE_REVISION;
  const currentRev = input.currentSurfaceRevision ?? SURFACE_REVISION;
  const surfaceBehind = installedRev < currentRev;

  let security = false;
  if (storeCoreBehind && input.securityVersions) {
    security = input.securityVersions.some(
      (sv) => compareSemver(input.installedStoreCoreVersion, sv) < 0,
    );
  }

  return {
    stale: storeCoreBehind || surfaceBehind,
    storeCoreBehind,
    surfaceBehind,
    security,
    installedStoreCoreVersion: input.installedStoreCoreVersion,
    currentStoreCoreVersion: input.currentStoreCoreVersion,
  };
}
