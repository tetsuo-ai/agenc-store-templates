/**
 * `<CatalogSection>` — the shared catalog grid (PLAN_2 C3, the `/` page). Wraps
 * `marketplace-react`'s `useListings` + `ListingGrid` and applies the store's
 * curation client-side, so all three templates render the SAME catalog and
 * differ only in routing/curation config.
 *
 * Client component (`"use client"`): it uses hooks. SSR-safe to import — the
 * directive marks the client boundary for the App Router.
 *
 * @module sections/CatalogSection
 */
"use client";
import { useMemo } from "react";
import type { ReactElement } from "react";
import { ListingGrid, type ListingCardData } from "@tetsuo-ai/marketplace-react";
import {
  useListings,
  type UseListingsFilter,
} from "@tetsuo-ai/marketplace-react/hooks";
import type { Curation } from "../config/schema.js";
import {
  applyCuration,
  curationIsActive,
  curationToListingsFilter,
  type CurateableListing,
} from "../config/curation.js";
import {
  EmptyCatalogSection,
  IndexerUnreachableSection,
  ZeroMatchSection,
} from "./states.js";
import type { StoreNetwork } from "../config/schema.js";

/** Props for {@link CatalogSection}. */
export interface CatalogSectionProps {
  /** The store's curation config (applied client-side + as a fast-path filter). */
  curation?: Curation;
  /** Target network (for the empty-state copy). */
  network: StoreNetwork;
  /** Per-page reveal size (forwarded to `useListings`). */
  pageSize?: number;
  /** Navigate to a listing detail (template-supplied router push). */
  onSelect?: (pda: string) => void;
  /** Navigate to a listing's hire/checkout (defaults to onSelect). */
  onHire?: (pda: string) => void;
  /** Emit no theme classes (white-label). */
  unstyled?: boolean;
}

/** Map a `ListingCardData` to the curation filter's minimal shape. */
function toCurateable(row: ListingCardData): CurateableListing {
  return {
    address: String(row.address),
    providerAgent: row.account.providerAgent
      ? String(row.account.providerAgent)
      : undefined,
    category: row.account.category
      ? decodeCategory(row.account.category)
      : undefined,
  };
}

/** Decode the on-chain fixed-byte category field to a trimmed string. */
function decodeCategory(category: unknown): string | undefined {
  if (typeof category === "string") return category.replace(/\0+$/, "");
  if (category instanceof Uint8Array || Array.isArray(category)) {
    const bytes = Uint8Array.from(category as ArrayLike<number>);
    return new TextDecoder()
      .decode(bytes)
      .replace(/\0+$/, "")
      .trim() || undefined;
  }
  return undefined;
}

/**
 * The catalog grid. Fetches active listings through the provider transport,
 * applies the store's curation, and renders the grid or the correct empty/error
 * state.
 *
 * @param props - {@link CatalogSectionProps}.
 */
export function CatalogSection({
  curation,
  network,
  pageSize,
  onSelect,
  onHire,
  unstyled,
}: CatalogSectionProps): ReactElement {
  // Server-side fast path (single provider/category) when curation narrows to one.
  const filter = useMemo<UseListingsFilter>(
    () => curationToListingsFilter(curation) as UseListingsFilter,
    [curation],
  );

  const { listings, isLoading, error, hasMore, fetchMore, refetch } =
    useListings(filter, pageSize ? { pageSize } : undefined);

  // Apply the FULL curation rule set client-side over the fetched window.
  const curated = useMemo(() => {
    const indexed = new Map(listings.map((row) => [String(row.address), row]));
    const filtered = applyCuration(listings.map(toCurateable), curation);
    return filtered
      .map((c) => indexed.get(c.address))
      .filter((row): row is ListingCardData => row !== undefined);
  }, [listings, curation]);

  // Error: indexer/transport unreachable.
  if (error && curated.length === 0) {
    return <IndexerUnreachableSection onRetry={refetch} unstyled={unstyled} />;
  }

  // Empty after load: distinguish "no supply" from "curation matched nothing".
  if (!isLoading && curated.length === 0) {
    if (listings.length > 0 && curationIsActive(curation)) {
      return <ZeroMatchSection unstyled={unstyled} />;
    }
    return <EmptyCatalogSection network={network} unstyled={unstyled} />;
  }

  return (
    <ListingGrid
      listings={curated}
      isLoading={isLoading}
      error={error}
      hasMore={hasMore}
      onLoadMore={fetchMore}
      onRetry={refetch}
      onHire={(row) => (onHire ?? onSelect)?.(String(row.address))}
      onSelect={onSelect ? (row) => onSelect(String(row.address)) : undefined}
      unstyled={unstyled}
    />
  );
}
