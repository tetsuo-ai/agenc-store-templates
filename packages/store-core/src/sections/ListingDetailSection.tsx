/**
 * `<ListingDetailSection>` — the shared `/listings/[pda]` body (PLAN_2 C3). Wraps
 * `useListing` + `ProviderCard` + `HireButton`, joining the listing, its
 * provider track record, and the moderation projection in one cached read. This
 * is the per-store SEO surface (the page that emits JSON-LD + OG); the SEO tags
 * are emitted by the template via the `store-core/seo` helpers, while this
 * section renders the interactive body.
 *
 * Client component (`"use client"`): it uses hooks.
 *
 * @module sections/ListingDetailSection
 */
"use client";
import type { ReactElement } from "react";
import {
  HireButton,
  ModerationBadge,
  ProviderCard,
  StateMessage,
  type HireCheckoutListing,
} from "@tetsuo-ai/marketplace-react";
import {
  useAgentTrackRecord,
  useListing,
  type AnyHireInput,
} from "@tetsuo-ai/marketplace-react/hooks";

/** Props for {@link ListingDetailSection}. */
export interface ListingDetailSectionProps {
  /** The ServiceListing PDA. */
  pda: string;
  /**
   * Build the per-hire input from the listing (compare-and-swap guards, taskId,
   * creatorAgent). Forwarded to `HireButton`; the referrer is auto-injected by
   * the provider when (and only when) the P6.2 capability is live.
   */
  buildHireInput: (listing: HireCheckoutListing) => AnyHireInput;
  /** Called after a successful hire (e.g. route to `/dashboard`). */
  onHired?: (taskPda: string) => void;
  /** Emit no theme classes (white-label). */
  unstyled?: boolean;
}

/**
 * The listing detail body: spec/price/provider + the hire CTA.
 *
 * @param props - {@link ListingDetailSectionProps}.
 */
export function ListingDetailSection({
  pda,
  buildHireInput,
  onHired,
  unstyled,
}: ListingDetailSectionProps): ReactElement {
  const { detail, listing, provider, moderation, isLoading, error, refetch } =
    useListing(pda);

  // The provider track record (indexer-native; null under gPA fallback).
  const trackRecordQuery = useAgentTrackRecord(provider ?? undefined, {
    enabled: Boolean(provider),
  });

  if (isLoading && !detail) {
    return <StateMessage kind="loading" unstyled={unstyled} />;
  }
  if (error && !detail) {
    return <StateMessage kind="error" onRetry={refetch} unstyled={unstyled} />;
  }
  if (!detail || !listing) {
    return (
      <StateMessage
        kind="empty"
        message="This listing was not found."
        unstyled={unstyled}
      />
    );
  }

  const checkoutListing: HireCheckoutListing = {
    address: detail.address,
    account: listing,
  };

  return (
    <div
      className={unstyled ? undefined : "agenc"}
      style={
        unstyled
          ? undefined
          : { display: "grid", gap: "1.5rem", gridTemplateColumns: "1fr" }
      }
    >
      <ModerationBadge moderation={moderation} unstyled={unstyled} />
      <ProviderCard
        agent={provider}
        trackRecord={trackRecordQuery.trackRecord}
        isLoading={trackRecordQuery.isLoading}
        error={trackRecordQuery.error}
        onRetry={trackRecordQuery.refetch}
        unstyled={unstyled}
      />
      <HireButton
        listing={checkoutListing}
        buildHireInput={buildHireInput}
        onHired={onHired ? (taskPda) => onHired(String(taskPda)) : undefined}
        unstyled={unstyled}
      />
    </div>
  );
}
