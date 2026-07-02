/**
 * `<ListingDetail>` — the client body of `/listings/[pda]`. Wraps the shared
 * `ListingDetailSection` (spec/price/provider track-record/moderation badge +
 * the hire→activation flow, all from store-core + marketplace-react) and
 * supplies the caller-specific `buildHireInput`.
 *
 * This store hires on the HUMANLESS (storefront-visitor) path: a plain-wallet
 * buyer with no registered marketplace agent. The task is pinned to
 * CreatorReview, so it settles via the buyer-review flow on `/dashboard`
 * (accept/reject) — the human reviews before funds release.
 *
 * After the hire lands, the flow AUTOMATICALLY pins the task's job spec
 * (`set_task_job_spec`) through this store's `/api/agenc/activate-job-spec`
 * route — a hired task is not claimable by workers until that happens. The
 * store referrer (wallet + feeBps from agenc.config.ts) is injected into the
 * hire at the provider level; it is never threaded through this input.
 *
 * Money safety: `onHired` fires the MOMENT the hire lands (before activation)
 * and records the task with `activated: false` + the repair context, so even
 * an activation failure leaves the funded task visible — and re-activatable —
 * on `/dashboard`. `onActivated` flips the record to `activated: true`.
 */
"use client";
import { useRouter } from "next/navigation";
import { ListingDetailSection } from "@tetsuo-ai/store-core/sections";
import type { HireCheckoutListing } from "@tetsuo-ai/marketplace-react";
import type { HumanlessHireFlowHireInput } from "@tetsuo-ai/marketplace-react/hooks";
import { addBuyerTask, markBuyerTaskActivated } from "@/lib/buyer-tasks";

/** Buyer review window before auto-acceptance, in seconds (7 days). */
const REVIEW_WINDOW_SECS = 7 * 24 * 60 * 60;

/** Generate a fresh 32-byte task id (the per-hire unique id). */
function randomTaskId(): Uint8Array {
  const id = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(id);
  } else {
    for (let i = 0; i < id.length; i++) id[i] = Math.floor(Math.random() * 256);
  }
  return id;
}

export function ListingDetail({ pda }: { pda: string }) {
  const router = useRouter();
  return (
    <ListingDetailSection
      pda={pda}
      buildHireInput={(
        listing: HireCheckoutListing,
      ): HumanlessHireFlowHireInput => ({
        // Humanless storefront-visitor hire → CreatorReview settlement. The
        // buyer (`creator`) defaults to the connected wallet signer; the
        // humanless flag + referrer are supplied by the flow/provider.
        listing: listing.address,
        taskId: randomTaskId(),
        // Compare-and-swap guards derived from the decoded listing so a price /
        // version change between page load and confirm fails safely on-chain.
        expectedPrice: listing.account.price,
        expectedVersion: listing.account.version,
        listingSpecHash: listing.account.specHash,
        // Window (seconds) the buyer has to review before auto-acceptance.
        reviewWindowSecs: REVIEW_WINDOW_SECS,
      })}
      // Track the task the moment the hire LANDS (before activation), with the
      // repair context — an activation hiccup leaves the task visible (and
      // re-activatable) on /dashboard instead of stranding the funded escrow.
      onHired={(taskPda, context) =>
        addBuyerTask({
          taskPda,
          listing: context.listing,
          taskIdHex: context.taskIdHex,
          hireSignature: context.hireSignature,
          referrerInjected: context.referrerInjected,
          jobSpec: context.jobSpec,
          activated: false,
        })
      }
      // Route only after the FULL flow (hire + job-spec pin) succeeds — the
      // task the buyer sees on the dashboard is claimable by workers.
      onActivated={(result) => {
        markBuyerTaskActivated(String(result.taskPda));
        router.push("/dashboard");
      }}
    />
  );
}
