/**
 * Curation: turn the {@link Curation} config into a filter over listings, and
 * into the indexer-side query the read transport accepts (PLAN_2 C2/C3).
 *
 * Two layers:
 * - {@link curationToListingsFilter} maps curation to the SDK
 *   `ListActiveListingsOptions` the read transport understands server-side
 *   (single provider / single category fast paths only — the indexer query is
 *   single-valued);
 * - {@link applyCuration} applies the FULL rule set client-side (multi-category,
 *   provider set, include/exclude, minRating) so the displayed catalog matches
 *   the config exactly regardless of which transport served it.
 *
 * `requireModeration` is surfaced as a flag for the section components to honor
 * via `marketplace-react`'s moderation badges; it is NOT applied as a hard
 * client filter here because the v1 read model does not project a standalone
 * attestation verdict (see `useListing` moderation note) — the components
 * render the badge and the store policy decides rendering.
 *
 * @module config/curation
 */
import type { Curation } from "./schema.js";

/**
 * A minimal listing shape the curation filter reads. Both the decoded on-chain
 * `ServiceListing` and the indexer's decoded projection satisfy it (the fields
 * used here — `providerAgent`/`provider`, `category` — exist on both, accessed
 * defensively).
 */
export interface CurateableListing {
  /** The listing PDA. */
  address: string;
  /** The provider agent PDA. */
  providerAgent?: string;
  /** Alternate provider field name (indexer projection). */
  provider?: string;
  /** The listing category token. */
  category?: string;
  /** Provider rating once P6.1 ratings are live. */
  rating?: number | null;
}

/**
 * The single-valued server-side query a curation config maps to. The indexer /
 * gPA `listActiveListings` accepts at most one `provider` and one `category`;
 * richer curation (multiple categories, provider sets, allow/deny) is applied
 * client-side by {@link applyCuration}.
 */
export interface CurationListingsFilter {
  /** Single provider fast-path (set only when curation names exactly one). */
  provider?: string;
  /** Single category fast-path (set only when curation names exactly one). */
  category?: string;
}

/**
 * Derive the server-side fast-path filter from a curation config. Only applies
 * when the config narrows to exactly one provider or one category — otherwise
 * the full set is fetched and {@link applyCuration} narrows it client-side.
 *
 * @param curation - The validated curation config (may be undefined).
 * @returns A {@link CurationListingsFilter}.
 */
export function curationToListingsFilter(
  curation?: Curation,
): CurationListingsFilter {
  const filter: CurationListingsFilter = {};
  if (!curation) return filter;
  if (curation.providers && curation.providers.length === 1) {
    filter.provider = curation.providers[0];
  }
  if (curation.categories && curation.categories.length === 1) {
    filter.category = curation.categories[0];
  }
  return filter;
}

/** Resolve a listing's provider PDA from either field name. */
function providerOf(listing: CurateableListing): string | undefined {
  return listing.providerAgent ?? listing.provider;
}

/**
 * Apply the FULL curation rule set to a listing array, client-side. Rules are
 * ANDed; `exclude` wins over everything.
 *
 * @param listings - The fetched listings.
 * @param curation - The validated curation config (undefined = no filtering).
 * @returns The filtered listings (a new array; input is not mutated).
 */
export function applyCuration<T extends CurateableListing>(
  listings: readonly T[],
  curation?: Curation,
): T[] {
  if (!curation) return [...listings];

  const categories = curation.categories;
  const providers = curation.providers;
  const include = curation.include;
  const exclude = curation.exclude;
  const minRating = curation.minRating;

  // Build the lookup sets as plain strings so comparisons are decoupled from
  // any branded `Address` type (the curation arrays and listing fields may
  // carry different `@solana/kit` brands across packages).
  const excludeSet = exclude ? new Set(exclude.map(String)) : null;
  const includeSet = include ? new Set(include.map(String)) : null;
  const providerSet = providers ? new Set(providers.map(String)) : null;
  const categorySet =
    categories && categories.length > 0 ? new Set(categories.map(String)) : null;

  return listings.filter((listing) => {
    // Denylist wins outright.
    if (excludeSet?.has(String(listing.address))) return false;
    // Allowlist (when present) is the ONLY admitted set, before other filters.
    if (includeSet && !includeSet.has(String(listing.address))) return false;
    // Provider set.
    if (providerSet) {
      const provider = providerOf(listing);
      if (!provider || !providerSet.has(String(provider))) return false;
    }
    // Category set.
    if (categorySet) {
      if (!listing.category || !categorySet.has(listing.category)) return false;
    }
    // Minimum rating — inert until ratings exist (a null/undefined rating is
    // NOT treated as failing, so the store never hides listings for lack of a
    // not-yet-live signal).
    if (
      typeof minRating === "number" &&
      typeof listing.rating === "number" &&
      listing.rating < minRating
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Whether a curation config has any active narrowing rule at all (used to
 * distinguish "zero matches because of filters" from "empty catalog" in the
 * empty-state copy).
 */
export function curationIsActive(curation?: Curation): boolean {
  if (!curation) return false;
  return Boolean(
    (curation.categories && curation.categories.length > 0) ||
      (curation.providers && curation.providers.length > 0) ||
      (curation.include && curation.include.length > 0) ||
      (curation.exclude && curation.exclude.length > 0) ||
      typeof curation.minRating === "number",
  );
}
