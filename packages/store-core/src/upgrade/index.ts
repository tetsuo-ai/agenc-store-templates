/**
 * `@tetsuo-ai/store-core/upgrade` — the instance-upgrade primitives (PLAN_2 C7).
 *
 * The C1 architecture rule (all protocol logic in versioned packages) makes an
 * update a dependency bump + redeploy. These primitives let a deployed store
 * NOTICE it is behind: a staleness check, the changelog feed hook, and the
 * owner-visible `<UpdateBanner>`.
 *
 * @module upgrade
 */
export {
  checkStaleness,
  compareSemver,
  STORE_CORE_VERSION,
  SURFACE_REVISION,
  type StalenessInput,
  type StalenessResult,
} from "./staleness.js";

export {
  useChangelogFeed,
  summarizeFeed,
  stalenessFromFeed,
  DEFAULT_CHANGELOG_FEED_URL,
  type ChangelogEntry,
  type ChangelogFeed,
  type UseChangelogFeedOptions,
  type UseChangelogFeedResult,
} from "./changelog.js";

export { UpdateBanner, type UpdateBannerProps } from "./UpdateBanner.js";
