/**
 * `<HireActivationButton>` — the connected hire entry point that finishes the
 * job (WP-B1). The plain `HireButton` stops at the hire transaction; on the
 * deployed program a hired task is NOT claimable until the creator pins its
 * job spec (`set_task_job_spec`) behind a CLEAN task-moderation attestation.
 * This button drives `useHumanlessHireFlow` end to end:
 *
 *   hire (escrow funded, CreatorReview pinned)
 *     → host + attest the job spec (the store's own activation route —
 *       marketplace-managed attestation, zero moderation config)
 *     → set_task_job_spec (the task becomes claimable).
 *
 * The provider-level referrer (store wallet + feeBps from `agenc.config.ts`)
 * is injected into the hire automatically by `useHumanlessHireFlow` whenever
 * the provider's referrer capability is live.
 *
 * Client component (`"use client"`): hooks + modal state.
 *
 * @module sections/HireActivationButton
 */
"use client";
import { useCallback, useRef, useState, type ReactElement } from "react";
import {
  Button,
  HireCheckoutModal,
  formatPriceSol,
  useAgencContext,
  type HireCheckoutListing,
} from "@tetsuo-ai/marketplace-react";
import {
  useHumanlessHireFlow,
  useWalletSigner,
  type HumanlessHireFlowHireInput,
  type HumanlessHireFlowResult,
} from "@tetsuo-ai/marketplace-react/hooks";
import {
  buildListingJobSpec,
  createStoreActivationHost,
  DEFAULT_ACTIVATION_ROUTE,
  type StoreJobSpecDraft,
} from "../activation/index.js";

/** Props for {@link HireActivationButton}. */
export interface HireActivationButtonProps {
  /** The listing to hire (decoded account + address). */
  listing: HireCheckoutListing;
  /**
   * Build the per-hire input (fresh 32-byte `taskId` + the compare-and-swap
   * guards) from the listing. The humanless/creator/referrer legs are supplied
   * by the flow + provider context — never by this input.
   */
  buildHireInput: (listing: HireCheckoutListing) => HumanlessHireFlowHireInput;
  /**
   * Build the job-spec draft hosted + attested + pinned for this hire.
   * Defaults to the "as listed" spec derived from the listing.
   */
  buildJobSpec?: (listing: HireCheckoutListing) => StoreJobSpecDraft;
  /**
   * The store's activation route. Defaults to
   * {@link DEFAULT_ACTIVATION_ROUTE} (same-origin).
   */
  activationEndpoint?: string;
  /** Called after the hire lands (before activation) with the Task PDA. */
  onHired?: (taskPda: string) => void;
  /** Called after the FULL flow (hire + job-spec pin) succeeds. */
  onActivated?: (result: HumanlessHireFlowResult) => void;
  /** Called when the buyer clicks "View task" on the success screen. */
  onViewTask?: (taskPda: string) => void;
  /** Show the price in the button label. Default true. */
  showPriceInLabel?: boolean;
  /** Override the button label. */
  label?: string;
  /** Emit no theme classes (white-label). */
  unstyled?: boolean;
  /** Extra root class. */
  className?: string;
}

/** Derive the default "as listed" job spec from the checkout listing. */
function defaultJobSpec(listing: HireCheckoutListing): StoreJobSpecDraft {
  const account = listing.account as {
    name?: ArrayLike<number>;
    specUri?: string;
  };
  let name = "";
  try {
    name = new TextDecoder()
      .decode(Uint8Array.from(account.name ?? []))
      .replace(/\0+$/, "")
      .trim();
  } catch {
    name = "";
  }
  return buildListingJobSpec({
    listingName: name || String(listing.address),
    specUri: account.specUri,
  });
}

/**
 * A connected hire + activation button with the standard checkout modal.
 *
 * @param props - {@link HireActivationButtonProps}.
 */
export function HireActivationButton({
  listing,
  buildHireInput,
  buildJobSpec,
  activationEndpoint = DEFAULT_ACTIVATION_ROUTE,
  onHired,
  onActivated,
  onViewTask,
  showPriceInLabel = true,
  label,
  unstyled,
  className,
}: HireActivationButtonProps): ReactElement {
  const ctx = useAgencContext();
  const flow = useHumanlessHireFlow<StoreJobSpecDraft>();
  const { connected } = useWalletSigner();
  const [open, setOpen] = useState(false);
  // Synchronous re-entrancy latch: a fast double-confirm would mint two funded
  // hires with fresh taskIds (two escrows). Same defense HireButton carries.
  const inFlightRef = useRef(false);
  // Fire onHired exactly once per flow run.
  const hiredNotified = useRef<string | null>(null);

  const capability = ctx.resolveReferrerCapability();

  const close = useCallback(() => {
    setOpen(false);
    inFlightRef.current = false;
    hiredNotified.current = null;
    flow.reset();
  }, [flow]);

  const confirm = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const result = await flow.hireAndActivate({
        hire: buildHireInput(listing),
        jobSpec: (buildJobSpec ?? defaultJobSpec)(listing),
        hostAndModerateJobSpec: createStoreActivationHost<StoreJobSpecDraft>({
          endpoint: activationEndpoint,
        }),
      });
      if (hiredNotified.current !== String(result.taskPda)) {
        hiredNotified.current = String(result.taskPda);
        onHired?.(String(result.taskPda));
      }
      onActivated?.(result);
    } finally {
      inFlightRef.current = false;
    }
  }, [
    activationEndpoint,
    buildHireInput,
    buildJobSpec,
    flow,
    listing,
    onActivated,
    onHired,
  ]);

  const buttonLabel =
    label ??
    (showPriceInLabel
      ? `Hire — ${formatPriceSol(listing.account.price)}`
      : "Hire");

  // The modal understands the mutation vocabulary; the flow's extra phases
  // (moderating/activating) are still "pending" to the buyer.
  const taskPda = flow.result?.taskPda ?? flow.progress.taskPda ?? null;

  return (
    <>
      <Button
        unstyled={unstyled}
        className={className}
        variant="primary"
        onClick={() => setOpen(true)}
      >
        {buttonLabel}
      </Button>
      <HireCheckoutModal
        open={open}
        onClose={close}
        listing={listing}
        onConfirm={confirm}
        status={flow.status}
        error={flow.error}
        taskPda={taskPda}
        onViewTask={
          onViewTask ? (pda) => onViewTask(String(pda)) : undefined
        }
        referrer={ctx.referrer}
        referrerLive={capability.live}
        connected={connected}
        unstyled={unstyled}
      />
    </>
  );
}
