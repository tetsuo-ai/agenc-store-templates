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
 * ## Money-safety invariants (review-hardened)
 *
 * 1. `onHired` fires from the flow's PROGRESS, the moment the hire lands —
 *    BEFORE activation. An activation failure therefore never loses the
 *    funded task: the template records it and `/dashboard` can repair it.
 * 2. Once a hire has landed but activation failed, the modal's Confirm NEVER
 *    re-hires: it retries ONLY the activation legs (host+attest as needed,
 *    then `set_task_job_spec` via `useTaskActivation`) against the EXISTING
 *    task PDA. Re-hiring would mint a SECOND full-price escrow.
 * 3. When the modal is closed with a stranded hire, an inline repair panel
 *    ({@link TaskActivationRepair}) stays visible under the button.
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
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { address } from "@solana/kit";
import {
  Button,
  HireCheckoutModal,
  formatPriceSol,
  useAgencContext,
  type HireCheckoutListing,
} from "@tetsuo-ai/marketplace-react";
import {
  useHumanlessHireFlow,
  useTaskActivation,
  useWalletSigner,
  type HumanlessHireFlowHireInput,
  type HumanlessHireFlowModerationResult,
  type HumanlessHireFlowResult,
} from "@tetsuo-ai/marketplace-react/hooks";
import {
  buildListingJobSpec,
  bytesToHex,
  createStoreActivationHost,
  DEFAULT_ACTIVATION_ROUTE,
  fetchStoreHireModerator,
  type StoreJobSpecDraft,
} from "../activation/index.js";
import { TaskActivationRepair } from "./TaskActivationRepair.js";

/**
 * The template-side hire input: `HumanlessHireFlowHireInput` with the P1.2
 * `moderator` OPTIONAL. When absent (the default for templates), the button
 * resolves it from the store's activation route (`GET` → the config override
 * or the attestation service's `/v1/info`, cached per session) before hiring —
 * the hire gate consumes the listing attestation recorded by that moderator.
 */
export type StoreHireInput = Omit<HumanlessHireFlowHireInput, "moderator"> & {
  /** Explicit P1.2 moderator override; auto-resolved when omitted. */
  moderator?: HumanlessHireFlowHireInput["moderator"];
};

/**
 * Context handed to `onHired` alongside the task PDA — everything a template
 * needs to persist for a later activation repair (dashboard retry).
 */
export interface HireLandedContext {
  /** The hired listing PDA. */
  listing: string;
  /** Hex of the per-hire 32-byte task id (null if unavailable). */
  taskIdHex: string | null;
  /** The confirmed hire signature (null until the flow reports it). */
  hireSignature: string | null;
  /** Whether the provider injected the store referrer into the hire. */
  referrerInjected: boolean;
  /** The job-spec draft this hire intended to pin. */
  jobSpec: StoreJobSpecDraft | null;
}

/** A landed-but-not-activated hire (the state the retry path repairs). */
interface StrandedHire {
  taskPda: string;
  taskId: Uint8Array | null;
  jobSpec: StoreJobSpecDraft | null;
  hireSignature: string | null;
  referrerInjected: boolean;
  /** Set when the moderation leg succeeded but `set_task_job_spec` failed. */
  jobSpecHash: Uint8Array | null;
  jobSpecUri: string | null;
  /** The P1.2 moderator of the successful moderation leg (retry shortcut). */
  moderator: string | null;
}

/** Props for {@link HireActivationButton}. */
export interface HireActivationButtonProps {
  /** The listing to hire (decoded account + address). */
  listing: HireCheckoutListing;
  /**
   * Build the per-hire input (fresh 32-byte `taskId` + the compare-and-swap
   * guards) from the listing. The humanless/creator/referrer legs are supplied
   * by the flow + provider context — never by this input. The P1.2
   * `moderator` is optional here: when omitted the button resolves it from
   * the store's activation route before hiring.
   */
  buildHireInput: (listing: HireCheckoutListing) => StoreHireInput;
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
  /**
   * Called the moment the hire LANDS (before activation) with the Task PDA
   * and the repair context. Fired from the flow's progress, so it runs even
   * when the activation legs subsequently fail.
   */
  onHired?: (taskPda: string, context: HireLandedContext) => void;
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
  // Fire onHired exactly once per minted task PDA.
  const hiredNotified = useRef<string | null>(null);
  // The inputs of the current/last attempt — captured BEFORE the hire is sent
  // so the landed-hire effect and the retry path can reuse the exact draft.
  const attemptRef = useRef<{
    taskId: Uint8Array;
    jobSpec: StoreJobSpecDraft;
  } | null>(null);
  // A landed-but-unactivated hire. Survives flow.reset()/modal close: while it
  // exists, Confirm retries ACTIVATION ONLY and never mints a second escrow.
  const [stranded, setStranded] = useState<StrandedHire | null>(null);
  const strandedRef = useRef<StrandedHire | null>(null);
  // The moderation detail of a successful retry (for onActivated passthrough).
  const retryModerationRef = useRef<unknown>(null);
  // The P1.2 moderator returned by the LAST successful host+attest leg — the
  // flow does not publish it through progress, so the host wrapper records it
  // here for the stranded-hire retry paths.
  const lastModeratorRef = useRef<string | null>(null);

  // Host+attest state of the RETRY path (the set_task_job_spec leg is the
  // useTaskActivation hook below, which carries its own status/error).
  const [retryHostPending, setRetryHostPending] = useState(false);
  const [retryHostError, setRetryHostError] = useState<Error | null>(null);
  const activation = useTaskActivation(
    (stranded?.taskPda ?? String(listing.address)) as Parameters<
      typeof useTaskActivation
    >[0],
  );

  const capability = ctx.resolveReferrerCapability();

  // ---- money-safety invariant 1: report the hire the moment it lands -----
  // The flow publishes progress.taskPda right after hireFromListingHumanless
  // confirms — BEFORE the moderation/activation legs run. Recording it here
  // (state + onHired) is what keeps a funded task visible when those legs
  // fail. Also captures hash/URI as they land so a retry can skip re-hosting.
  const progressTaskPda = flow.progress.taskPda;
  const progressHireSignature = flow.progress.hireSignature;
  const progressReferrerInjected = flow.progress.referrerInjected;
  const progressJobSpecHash = flow.progress.jobSpecHash;
  const progressJobSpecUri = flow.progress.jobSpecUri;
  useEffect(() => {
    if (!progressTaskPda) return;
    const pda = String(progressTaskPda);
    const attempt = attemptRef.current;
    const next: StrandedHire = {
      taskPda: pda,
      taskId: attempt?.taskId ?? null,
      jobSpec: attempt?.jobSpec ?? null,
      hireSignature: progressHireSignature,
      referrerInjected: progressReferrerInjected,
      jobSpecHash: progressJobSpecHash
        ? new Uint8Array(progressJobSpecHash as unknown as ArrayLike<number>)
        : null,
      jobSpecUri: progressJobSpecUri ?? null,
      moderator: lastModeratorRef.current,
    };
    strandedRef.current = next;
    setStranded(next);
    if (hiredNotified.current !== pda) {
      hiredNotified.current = pda;
      onHired?.(pda, {
        listing: String(listing.address),
        taskIdHex: attempt ? bytesToHex(attempt.taskId) : null,
        hireSignature: progressHireSignature,
        referrerInjected: progressReferrerInjected,
        jobSpec: attempt?.jobSpec ?? null,
      });
    }
  }, [
    progressTaskPda,
    progressHireSignature,
    progressReferrerInjected,
    progressJobSpecHash,
    progressJobSpecUri,
    onHired,
    listing.address,
  ]);

  const clearStranded = useCallback(() => {
    strandedRef.current = null;
    setStranded(null);
  }, []);

  // ---- money-safety invariant 2: retry activation, never re-hire ---------
  const retryActivation = useCallback(
    async (target: StrandedHire) => {
      setRetryHostError(null);
      activation.reset();
      try {
        let jobSpecHash = target.jobSpecHash;
        let jobSpecUri = target.jobSpecUri;
        let moderator = target.moderator;
        if (!jobSpecHash || !jobSpecUri || !moderator) {
          // Re-run the host+attest leg for the SAME task. Idempotent: the
          // canonical draft re-hashes identically, so the route re-hosts the
          // same document and re-requests the attestation. Also the P1.2
          // moderator source of truth — whoever signs THIS attestation is
          // whose record `set_task_job_spec` consumes.
          setRetryHostPending(true);
          try {
            const host = createStoreActivationHost<StoreJobSpecDraft>({
              endpoint: activationEndpoint,
            });
            const moderation = await host({
              taskPda: target.taskPda,
              taskId: target.taskId ?? new Uint8Array(32),
              listing: String(listing.address),
              jobSpec:
                target.jobSpec ?? (buildJobSpec ?? defaultJobSpec)(listing),
              hireSignature: target.hireSignature ?? "",
              referrerInjected: target.referrerInjected,
            });
            jobSpecHash = moderation.jobSpecHash;
            jobSpecUri = moderation.jobSpecUri;
            moderator = moderation.moderator;
            lastModeratorRef.current = moderator;
            retryModerationRef.current = moderation.moderation;
            const updated: StrandedHire = {
              ...target,
              jobSpecHash,
              jobSpecUri,
              moderator,
            };
            strandedRef.current = updated;
            setStranded(updated);
          } finally {
            setRetryHostPending(false);
          }
        }
        if (!jobSpecHash || !jobSpecUri || !moderator) {
          throw new Error("Activation host returned no job-spec pointer.");
        }
        const signature = await activation.activate({
          jobSpecHash,
          jobSpecUri,
          moderator: address(moderator),
        } as Parameters<typeof activation.activate>[0]);
        // Activation repaired — the task is claimable; nothing is stranded.
        clearStranded();
        onActivated?.({
          taskPda: target.taskPda,
          hireSignature: target.hireSignature ?? "",
          activationSignature: signature,
          jobSpecHash,
          jobSpecUri,
          referrerInjected: target.referrerInjected,
          moderation: retryModerationRef.current,
        } as unknown as HumanlessHireFlowResult);
      } catch (cause) {
        // Surface every failure through state — never an unhandled rejection
        // (the modal owns the display).
        setRetryHostError(
          cause instanceof Error ? cause : new Error(String(cause)),
        );
      }
    },
    [
      activation,
      activationEndpoint,
      buildJobSpec,
      clearStranded,
      listing,
      onActivated,
    ],
  );

  const close = useCallback(() => {
    setOpen(false);
    inFlightRef.current = false;
    // NOTE: strandedRef/stranded deliberately survive close — a funded,
    // unactivated task must keep its repair path (inline panel + dashboard).
    flow.reset();
  }, [flow]);

  const confirm = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      // A landed hire without a pinned job spec exists → Confirm REPAIRS it.
      // It never builds a new hire input (a fresh taskId = a second escrow).
      const target = strandedRef.current;
      if (target) {
        await retryActivation(target);
        return;
      }
      // Fresh hire: clear any retry state left from a PREVIOUS repaired hire
      // so its success/error cannot leak into this attempt's modal status.
      activation.reset();
      setRetryHostError(null);
      retryModerationRef.current = null;
      lastModeratorRef.current = null;
      const hireInput = buildHireInput(listing);
      const jobSpec = (buildJobSpec ?? defaultJobSpec)(listing);
      attemptRef.current = {
        taskId: Uint8Array.from(hireInput.taskId as ArrayLike<number>),
        jobSpec,
      };
      // P1.2: the hire gate names the moderator whose LISTING attestation it
      // consumes. Resolve it BEFORE any money moves — explicit input override
      // first, else the store's activation route — LISTING-SCOPED (§12
      // roster-trust rail): `?listing=<pda>` resolves the moderator whose
      // consumable record ACTUALLY EXISTS for this listing (own attestor /
      // global authority / any bonded roster attestor under the store's
      // trust policy), acquiring a fresh attestation on a miss. The
      // listing-agnostic answer could name a moderator with NO record for
      // this listing — a cross-node hire would revert AFTER the buyer
      // signed. Fail-closed: a resolution failure aborts HERE, before the
      // escrow is funded (and is surfaced through state — it happens outside
      // the flow mutation, so the flow's own error state never sees it).
      let hireModerator: HumanlessHireFlowHireInput["moderator"];
      try {
        hireModerator =
          hireInput.moderator ??
          address(
            await fetchStoreHireModerator({
              endpoint: activationEndpoint,
              listing: String(listing.address),
            }),
          );
      } catch (cause) {
        setRetryHostError(
          cause instanceof Error ? cause : new Error(String(cause)),
        );
        return;
      }
      // Wrap the host to capture the task-attestation moderator for the
      // stranded-hire retry paths (the flow consumes it internally but does
      // not publish it through progress).
      const host = createStoreActivationHost<StoreJobSpecDraft>({
        endpoint: activationEndpoint,
      });
      const result = await flow.hireAndActivate({
        hire: { ...hireInput, moderator: hireModerator },
        jobSpec,
        hostAndModerateJobSpec: async (input) => {
          const moderation = await host(input);
          lastModeratorRef.current = moderation.moderator;
          return moderation as unknown as HumanlessHireFlowModerationResult;
        },
      });
      clearStranded();
      if (hiredNotified.current !== String(result.taskPda)) {
        hiredNotified.current = String(result.taskPda);
        onHired?.(String(result.taskPda), {
          listing: String(listing.address),
          taskIdHex: bytesToHex(attemptRef.current.taskId),
          hireSignature: result.hireSignature,
          referrerInjected: result.referrerInjected,
          jobSpec,
        });
      }
      onActivated?.(result);
    } catch {
      // Swallow: the flow/retry state already carries the surfaced error
      // (flow.error / retryHostError / activation.error). Rethrowing here
      // would only produce an unhandled promise rejection in the modal.
    } finally {
      inFlightRef.current = false;
    }
  }, [
    activation,
    activationEndpoint,
    buildHireInput,
    buildJobSpec,
    clearStranded,
    flow,
    listing,
    onActivated,
    onHired,
    retryActivation,
  ]);

  const buttonLabel =
    label ??
    (showPriceInLabel
      ? `Hire — ${formatPriceSol(listing.account.price)}`
      : "Hire");

  // ---- status/error surfaced to the modal --------------------------------
  // The retry path (stranded set + any retry state) overrides the flow's
  // terminal error so the buyer sees the repair progressing.
  const retryError = retryHostError ?? activation.error;
  const retryPending = retryHostPending || activation.isPending;
  const retrySucceeded = !stranded && activation.signature !== null;
  const status = retryPending
    ? ("pending" as const)
    : retrySucceeded
      ? ("success" as const)
      : retryError
        ? ("error" as const)
        : flow.status;
  const rawError = retryError ?? flow.error;
  // With a stranded hire, make the displayed error state the truth: the money
  // already left, Confirm retries ONLY the activation (no second charge).
  const error =
    rawError && stranded
      ? new Error(
          `${rawError.message} Your hire is already funded on-chain — Confirm retries ONLY the activation (it will not charge again), or finish it later from the dashboard.`,
        )
      : rawError;

  const taskPdaValue =
    flow.result?.taskPda ?? flow.progress.taskPda ?? stranded?.taskPda ?? null;
  const taskPda = (
    taskPdaValue === null ? null : String(taskPdaValue)
  ) as Parameters<typeof HireCheckoutModal>[0]["taskPda"];

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
      {/* Money-safety invariant 3: a stranded hire stays repairable on the
          page even after the modal closes. */}
      {stranded && !open ? (
        <TaskActivationRepair
          taskPda={stranded.taskPda}
          listing={String(listing.address)}
          taskIdHex={stranded.taskId ? bytesToHex(stranded.taskId) : null}
          jobSpec={stranded.jobSpec}
          hireSignature={stranded.hireSignature}
          referrerInjected={stranded.referrerInjected}
          jobSpecHashHex={
            stranded.jobSpecHash ? bytesToHex(stranded.jobSpecHash) : null
          }
          jobSpecUri={stranded.jobSpecUri}
          moderator={stranded.moderator}
          activationEndpoint={activationEndpoint}
          onActivated={(repair) => {
            clearStranded();
            onActivated?.({
              taskPda: repair.taskPda,
              hireSignature: stranded.hireSignature ?? "",
              activationSignature: repair.activationSignature,
              jobSpecHash: repair.jobSpecHash,
              jobSpecUri: repair.jobSpecUri,
              referrerInjected: stranded.referrerInjected,
              moderation: repair.moderation,
            } as unknown as HumanlessHireFlowResult);
          }}
          unstyled={unstyled}
        />
      ) : null}
      <HireCheckoutModal
        open={open}
        onClose={close}
        listing={listing}
        onConfirm={confirm}
        status={status}
        error={error}
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
