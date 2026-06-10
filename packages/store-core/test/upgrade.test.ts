/**
 * Instance-upgrade tests (PLAN_2 C7): the staleness check drives the
 * owner-visible banner; semver comparison + the security flag behave.
 */
import { describe, it, expect } from "vitest";
import {
  checkStaleness,
  compareSemver,
  summarizeFeed,
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
      entries: [
        { version: "0.3.0", date: "2026-06-10", summary: "latest" },
        { version: "0.2.0", date: "2026-06-01", summary: "sec", security: true },
        { version: "0.1.0", date: "2026-05-01", summary: "first" },
      ],
    };
    const summary = summarizeFeed(feed);
    expect(summary.latestVersion).toBe("0.3.0");
    expect(summary.securityVersions).toEqual(["0.2.0"]);
  });

  it("handles an empty feed", () => {
    const summary = summarizeFeed({
      schema: "agenc.store-changelog/v1",
      entries: [],
    });
    expect(summary.latestVersion).toBeNull();
    expect(summary.securityVersions).toEqual([]);
  });
});
