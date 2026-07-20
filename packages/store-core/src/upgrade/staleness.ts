/**
 * Instance staleness check (PLAN_2 C7). One-click deploys create forks no bot
 * updates. This compares a deployed store's pinned `store-core` version and
 * target on-chain `surface_revision` against the current values and reports
 * whether the instance is behind — so a template can render an OWNER-VISIBLE
 * update banner, flagging security-relevant updates.
 *
 * Pure semver comparison; no network. The "current" side is supplied by the
 * changelog feed (see `./changelog.ts`) or pinned by the build.
 *
 * @module upgrade/staleness
 */

import { SURFACE_REVISION_CURRENT } from "@tetsuo-ai/marketplace-sdk";
import packageJson from "../../package.json";

/**
 * The `store-core` version this build was compiled against — sourced from
 * package.json at build time so it can never drift from the published
 * version (it previously hardcoded "0.1.0" inside the 0.3.x package, making
 * the staleness banner compare against a fiction).
 */
export const STORE_CORE_VERSION: string = packageJson.version;

/**
 * The on-chain surface revision this build targets. Sourced from the SDK's
 * revision-5 capability model so the owner-visible update check cannot drift
 * onto the old pre-P6.5 zero placeholder.
 */
export const SURFACE_REVISION = SURFACE_REVISION_CURRENT;

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
  /** The current surface revision advertised by the changelog feed. */
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
  /** The on-chain surface revision this installed build targets. */
  installedSurfaceRevision: number;
  /** The current on-chain surface revision advertised by the release feed. */
  currentSurfaceRevision: number;
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
 *   `store-core` version is below a flagged security release.
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
    installedSurfaceRevision: installedRev,
    currentSurfaceRevision: currentRev,
    security,
    installedStoreCoreVersion: input.installedStoreCoreVersion,
    currentStoreCoreVersion: input.currentStoreCoreVersion,
  };
}
