/**
 * `<StoreUpdateBanner>` — the C7 owner-visible staleness banner, wired to the
 * published changelog feed. Renders NOTHING when the instance is current;
 * renders an update notice (security updates flagged) when behind.
 *
 * The banner compares THIS build's pinned `STORE_CORE_VERSION` against the
 * latest version in the changelog feed — so a deployed fork (which no bot
 * updates) can SEE that an update exists. An update is a dependency bump +
 * redeploy, never a template-code merge (the C1 architecture rule).
 *
 * The changelog fetch is gated to AFTER mount (`enabled` flips on once the
 * client hydrates) so the banner makes no network request during SSR / static
 * prerender — the banner is owner-facing chrome, not request-critical.
 */
"use client";
import { useEffect, useState } from "react";
import {
  UpdateBanner,
  useChangelogFeed,
  STORE_CORE_VERSION,
  DEFAULT_CHANGELOG_FEED_URL,
} from "@tetsuo-ai/store-core/upgrade";

export function StoreUpdateBanner() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { staleness } = useChangelogFeed({
    installedVersion: STORE_CORE_VERSION,
    feedUrl: DEFAULT_CHANGELOG_FEED_URL,
    enabled: mounted,
  });
  return (
    <UpdateBanner staleness={staleness} changelogUrl={DEFAULT_CHANGELOG_FEED_URL} />
  );
}
