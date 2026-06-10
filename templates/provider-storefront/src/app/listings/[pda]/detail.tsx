/**
 * `<ListingDetail>` — the client body of `/listings/[pda]`. Wraps the shared
 * `ListingDetailSection` (spec/price/provider track-record/moderation badge +
 * HireButton, all from store-core + marketplace-react) and supplies the
 * caller-specific `buildHireInput`.
 *
 * This store hires on the HUMANLESS (storefront-visitor) path: a plain-wallet
 * buyer with no registered marketplace agent. The task is pinned to
 * CreatorReview, so it settles via the buyer-review flow on `/dashboard`
 * (accept/reject) — the human reviews before funds release. The referrer is
 * NEVER threaded through this input; it is provider-level config gated by P6.2.
 */
"use client";
import { useRouter } from "next/navigation";
import { ListingDetailSection } from "@tetsuo-ai/store-core/sections";
import type { HireCheckoutListing } from "@tetsuo-ai/marketplace-react";
import type { AnyHireInput } from "@tetsuo-ai/marketplace-react/hooks";
import { addBuyerTask } from "@/lib/buyer-tasks";

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
      buildHireInput={(listing: HireCheckoutListing): AnyHireInput => ({
        // Humanless storefront-visitor hire → CreatorReview settlement. The
        // buyer (`creator`) defaults to the provider's connected wallet signer.
        humanless: true,
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
      onHired={(taskPda) => {
        addBuyerTask(taskPda);
        router.push("/dashboard");
      }}
    />
  );
}
