/**
 * `<ListingDetailSection>` — the shared `/listings/[pda]` body (PLAN_2 C3).
 * Wraps `useListing` + `ProviderCard` + the hire→activation flow
 * ({@link HireActivationButton}), joining the listing, its provider track
 * record, and the moderation projection in one cached read. This is the
 * per-store SEO surface (the page that emits JSON-LD + OG); the SEO tags are
 * emitted by the template via the `store-core/seo` helpers, while this section
 * renders the interactive body.
 *
 * The hire path is HUMANLESS (storefront-visitor): a plain-wallet buyer, task
 * pinned to CreatorReview, and — because a hired task is unclaimable until its
 * job spec is pinned — the flow chains `set_task_job_spec` behind the store's
 * activation route automatically (marketplace-managed attestation, zero
 * moderation config). The store referrer is injected at the provider level.
 *
 * Client component (`"use client"`): it uses hooks.
 *
 * @module sections/ListingDetailSection
 */
"use client";
import type { ReactElement } from "react";
import {
  ModerationBadge,
  ProviderCard,
  StateMessage,
  type HireCheckoutListing,
} from "@tetsuo-ai/marketplace-react";
import {
  useAgentTrackRecord,
  useListing,
  type HumanlessHireFlowHireInput,
  type HumanlessHireFlowResult,
} from "@tetsuo-ai/marketplace-react/hooks";
import {
  HireActivationButton,
  type HireActivationButtonProps,
} from "./HireActivationButton.js";
import type { StoreJobSpecDraft } from "../activation/index.js";

/** Props for {@link ListingDetailSection}. */
export interface ListingDetailSectionProps {
  /** The ServiceListing PDA. */
  pda: string;
  /**
   * Build the per-hire input from the listing (compare-and-swap guards, fresh
   * taskId, review window). Forwarded to the hire→activation flow; the
   * referrer is auto-injected by the provider whenever one is configured.
   */
  buildHireInput: (listing: HireCheckoutListing) => HumanlessHireFlowHireInput;
  /**
   * Build the job-spec draft pinned after the hire. Defaults to the
   * "as listed" spec derived from the listing.
   */
  buildJobSpec?: HireActivationButtonProps["buildJobSpec"];
  /** The store's activation route (defaults to the same-origin route). */
  activationEndpoint?: string;
  /**
   * Called the moment the hire LANDS (before activation) with the Task PDA
   * and the repair context — record it so an activation failure leaves the
   * funded task visible (and re-activatable) on the dashboard.
   */
  onHired?: HireActivationButtonProps["onHired"];
  /** Called after the FULL flow (hire + job-spec pin) succeeds. */
  onActivated?: (result: HumanlessHireFlowResult) => void;
  /** Emit no theme classes (white-label). */
  unstyled?: boolean;
}

export type { StoreJobSpecDraft };

/**
 * The listing detail body: spec/price/provider + the hire→activation CTA.
 *
 * @param props - {@link ListingDetailSectionProps}.
 */
export function ListingDetailSection({
  pda,
  buildHireInput,
  buildJobSpec,
  activationEndpoint,
  onHired,
  onActivated,
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
      <HireActivationButton
        listing={checkoutListing}
        buildHireInput={buildHireInput}
        buildJobSpec={buildJobSpec}
        activationEndpoint={activationEndpoint}
        onHired={onHired}
        onActivated={onActivated}
        unstyled={unstyled}
      />
    </div>
  );
}
