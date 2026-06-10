/**
 * The changelog feed (PLAN_2 C7) — the update banner links to it, and the
 * staleness check's "current version" can be sourced from it. The feed is a
 * small JSON document published alongside the templates repo; the hook fetches
 * it and derives the latest version + whether a security release is newer than
 * the installed one.
 *
 * SSR-safe: the hook makes no request at module scope and is disabled until a
 * feed URL is supplied.
 *
 * @module upgrade/changelog
 */
import { useQuery } from "@tanstack/react-query";
import { checkStaleness, type StalenessResult } from "./staleness.js";

/** One changelog entry as published in the feed JSON. */
export interface ChangelogEntry {
  /** The `store-core` (and template) version this entry describes. */
  version: string;
  /** ISO date of the release. */
  date: string;
  /** Short human-readable summary. */
  summary: string;
  /** Whether this release carries a security fix. */
  security?: boolean;
  /** A link to the full release notes. */
  url?: string;
}

/** The published changelog feed document. */
export interface ChangelogFeed {
  /** Schema marker. */
  schema: "agenc.store-changelog/v1";
  /** Entries, newest first. */
  entries: ChangelogEntry[];
}

/** The default changelog feed location (template README links here too). */
export const DEFAULT_CHANGELOG_FEED_URL =
  "https://raw.githubusercontent.com/tetsuo-ai/agenc-store-templates/main/CHANGELOG.json";

/** Derive the latest (highest) version + security versions from a feed. */
export function summarizeFeed(feed: ChangelogFeed): {
  latestVersion: string | null;
  securityVersions: string[];
} {
  if (feed.entries.length === 0) {
    return { latestVersion: null, securityVersions: [] };
  }
  // Entries are newest-first by contract; the first is the latest.
  const latestVersion = feed.entries[0]?.version ?? null;
  const securityVersions = feed.entries
    .filter((entry) => entry.security)
    .map((entry) => entry.version);
  return { latestVersion, securityVersions };
}

/** Options for {@link useChangelogFeed}. */
export interface UseChangelogFeedOptions {
  /** The feed URL. Defaults to {@link DEFAULT_CHANGELOG_FEED_URL}. */
  feedUrl?: string;
  /**
   * The installed `store-core` version (typically `STORE_CORE_VERSION`). When
   * supplied, the result includes a {@link StalenessResult}.
   */
  installedVersion?: string;
  /** Disable the fetch (e.g. during SSR or in tests). Default `true`. */
  enabled?: boolean;
  /** Injected fetch implementation (tests). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Return value of {@link useChangelogFeed}. */
export interface UseChangelogFeedResult {
  /** The fetched feed, or null. */
  feed: ChangelogFeed | null;
  /** The latest published version, or null. */
  latestVersion: string | null;
  /** The staleness verdict (present when `installedVersion` was supplied). */
  staleness: StalenessResult | null;
  /** True while the feed is loading. */
  isLoading: boolean;
  /** The fetch error, or null. */
  error: Error | null;
  /** Force a refetch. */
  refetch: () => void;
}

/**
 * Fetch the changelog feed and (when `installedVersion` is supplied) compute the
 * staleness verdict the update banner renders.
 *
 * @param options - {@link UseChangelogFeedOptions}.
 * @returns {@link UseChangelogFeedResult}.
 */
export function useChangelogFeed(
  options?: UseChangelogFeedOptions,
): UseChangelogFeedResult {
  const feedUrl = options?.feedUrl ?? DEFAULT_CHANGELOG_FEED_URL;
  const enabled = options?.enabled ?? true;
  const fetchImpl = options?.fetchImpl;

  const query = useQuery<ChangelogFeed, Error>({
    queryKey: ["agenc-store", "changelog", feedUrl],
    enabled,
    queryFn: async () => {
      const doFetch = fetchImpl ?? fetch;
      const response = await doFetch(feedUrl);
      if (!response.ok) {
        throw new Error(
          `changelog feed fetch failed: ${response.status} ${response.statusText}`,
        );
      }
      return (await response.json()) as ChangelogFeed;
    },
  });

  const feed = query.data ?? null;
  const summary = feed ? summarizeFeed(feed) : null;
  const latestVersion = summary?.latestVersion ?? null;

  let staleness: StalenessResult | null = null;
  if (options?.installedVersion && latestVersion) {
    staleness = checkStaleness({
      installedStoreCoreVersion: options.installedVersion,
      currentStoreCoreVersion: latestVersion,
      securityVersions: summary?.securityVersions,
    });
  }

  return {
    feed,
    latestVersion,
    staleness,
    isLoading: query.isLoading,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}
