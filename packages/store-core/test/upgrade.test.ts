/**
 * Instance-upgrade tests (PLAN_2 C7): the staleness check drives the
 * owner-visible banner; semver comparison + the security flag behave.
 */
import { describe, it, expect } from "vitest";
import {
  checkStaleness,
  compareSemver,
  stalenessFromFeed,
  summarizeFeed,
  SURFACE_REVISION,
  type ChangelogFeed,
} from "../src/upgrade/index.js";

describe("compareSemver", () => {
  it("orders versions correctly", () => {
    expect(compareSemver("0.1.0", "0.2.0")).toBe(-1);
    expect(compareSemver("1.0.0", "0.9.9")).toBe(1);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("0.1.0", "0.1.1")).toBe(-1);
  });
  it("ignores prerelease suffixes", () => {
    expect(compareSemver("0.1.0-rc.1", "0.1.0")).toBe(0);
  });
});

describe("checkStaleness", () => {
  it("flags an outdated store-core version as stale", () => {
    const result = checkStaleness({
      installedStoreCoreVersion: "0.1.0",
      currentStoreCoreVersion: "0.2.0",
    });
    expect(result.stale).toBe(true);
    expect(result.storeCoreBehind).toBe(true);
  });

  it("is NOT stale when current", () => {
    const result = checkStaleness({
      installedStoreCoreVersion: "0.2.0",
      currentStoreCoreVersion: "0.2.0",
    });
    expect(result.stale).toBe(false);
    expect(result.installedSurfaceRevision).toBe(5);
    expect(result.currentSurfaceRevision).toBe(5);
  });

  it("flags a surface-revision lag as stale", () => {
    const result = checkStaleness({
      installedStoreCoreVersion: "0.2.0",
      currentStoreCoreVersion: "0.2.0",
      installedSurfaceRevision: 0,
      currentSurfaceRevision: 1,
    });
    expect(result.stale).toBe(true);
    expect(result.surfaceBehind).toBe(true);
    expect(result.installedSurfaceRevision).toBe(0);
    expect(result.currentSurfaceRevision).toBe(1);
  });

  it("marks security when a behind version crosses a flagged security release", () => {
    const result = checkStaleness({
      installedStoreCoreVersion: "0.1.0",
      currentStoreCoreVersion: "0.3.0",
      securityVersions: ["0.2.0"],
    });
    expect(result.security).toBe(true);
  });

  it("does NOT mark security when behind only on non-security releases", () => {
    const result = checkStaleness({
      installedStoreCoreVersion: "0.2.0",
      currentStoreCoreVersion: "0.3.0",
      securityVersions: ["0.2.0"],
    });
    // installed (0.2.0) is NOT below the security version (0.2.0).
    expect(result.security).toBe(false);
  });
});

describe("summarizeFeed", () => {
  it("derives the latest version + security versions (newest-first contract)", () => {
    const feed: ChangelogFeed = {
      schema: "agenc.store-changelog/v1",
      surfaceRevision: 5,
      entries: [
        { version: "0.3.0", date: "2026-06-10", summary: "latest" },
        { version: "0.2.0", date: "2026-06-01", summary: "sec", security: true },
        { version: "0.1.0", date: "2026-05-01", summary: "first" },
      ],
    };
    const summary = summarizeFeed(feed);
    expect(summary.latestVersion).toBe("0.3.0");
    expect(summary.securityVersions).toEqual(["0.2.0"]);
    expect(summary.surfaceRevision).toBe(5);
  });

  it("handles an empty feed", () => {
    const summary = summarizeFeed({
      schema: "agenc.store-changelog/v1",
      surfaceRevision: 5,
      entries: [],
    });
    expect(summary.latestVersion).toBeNull();
    expect(summary.securityVersions).toEqual([]);
    expect(summary.surfaceRevision).toBe(5);
  });

  it("carries revision 5 from the feed into the staleness result", () => {
    const feed: ChangelogFeed = {
      schema: "agenc.store-changelog/v1",
      surfaceRevision: 5,
      entries: [
        { version: "0.6.1", date: "2026-07-19", summary: "current" },
      ],
    };

    const current = stalenessFromFeed("0.6.1", feed);
    expect(SURFACE_REVISION).toBe(5);
    expect(current).toMatchObject({
      stale: false,
      surfaceBehind: false,
      installedSurfaceRevision: 5,
      currentSurfaceRevision: 5,
    });

    const revisionFour = stalenessFromFeed("0.6.1", feed, 4);
    expect(revisionFour).toMatchObject({
      stale: true,
      storeCoreBehind: false,
      surfaceBehind: true,
      installedSurfaceRevision: 4,
      currentSurfaceRevision: 5,
    });

    const publishedFeed = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../../CHANGELOG.json", import.meta.url)),
        "utf8",
      ),
    ) as ChangelogFeed;
    expect(publishedFeed.surfaceRevision).toBe(5);
    expect(stalenessFromFeed("0.6.1", publishedFeed)).toMatchObject({
      stale: false,
      installedSurfaceRevision: 5,
      currentSurfaceRevision: 5,
    });
  });
});

// ---------------------------------------------------------------------------
// Cross-node canary regressions (2026-07-02)
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STORE_CORE_VERSION } from "../src/upgrade/index.js";

describe("STORE_CORE_VERSION", () => {
  it("always equals the package.json version (was hardcoded '0.1.0' inside 0.3.x)", () => {
    // REVERT-SENSITIVE: against the pre-fix source this fails — the constant
    // was a hardcoded "0.1.0" that drifted from every published version, so
    // the staleness banner compared against a fiction.
    const pkg = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../package.json", import.meta.url)),
        "utf8",
      ),
    ) as { version: string };
    expect(STORE_CORE_VERSION).toBe(pkg.version);
  });
});

describe("react-query must never be bundled", () => {
  it("tsup externalizes @tanstack/react-query and package.json declares it", async () => {
    // REVERT-SENSITIVE: against the pre-fix tsup config this fails. A bundled
    // react-query copy carries its own React context, so useChangelogFeed's
    // useQuery could not see AgencProvider's QueryClient ("No QueryClient
    // set") and every page of every scaffolded store 500'd on SSR.
    const tsupSource = readFileSync(
      fileURLToPath(new URL("../tsup.config.ts", import.meta.url)),
      "utf8",
    );
    expect(tsupSource).toContain('"@tanstack/react-query"');
    const pkg = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../package.json", import.meta.url)),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.["@tanstack/react-query"]).toBeTruthy();
  });
});
