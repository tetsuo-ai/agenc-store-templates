/**
 * `<TaskActivationRepair>` — the re-activation surface for a hired task whose
 * job spec was never pinned (WP-B1 review hardening).
 *
 * A hire funds the escrow immediately; the task only becomes claimable after
 * `set_task_job_spec` lands behind a CLEAN task-moderation attestation. When
 * any activation leg fails (attestor outage, route error, wallet rejection),
 * the buyer is left with a FUNDED task workers cannot claim. This panel
 * repairs exactly that state, and ONLY that state:
 *
 *   re-host + re-attest the job spec through the store's activation route
 *   (skipped when the hash/URI from the failed attempt are already known)
 *     → `set_task_job_spec` via `useTaskActivation` against the EXISTING
 *       task PDA.
 *
 * It never hires: there is no code path here that can mint a second escrow.
 * Rendered inline by {@link HireActivationButton} after a failed activation,
 * and by the template `/dashboard` for persisted unactivated hires.
 *
 * Client component (`"use client"`): hooks.
 *
 * @module sections/TaskActivationRepair
 */
"use client";
import { useCallback, useRef, useState, type ReactElement } from "react";
import { Button } from "@tetsuo-ai/marketplace-react";
import { useTaskActivation } from "@tetsuo-ai/marketplace-react/hooks";
import {
  buildListingJobSpec,
  createStoreActivationHost,
  DEFAULT_ACTIVATION_ROUTE,
  HASH_HEX_RE,
  hexToBytes,
  type StoreJobSpecDraft,
} from "../activation/index.js";

/** What {@link TaskActivationRepair} reports on success. */
export interface TaskActivationRepairResult {
  /** The repaired task PDA. */
  taskPda: string;
  /** The `set_task_job_spec` signature. */
  activationSignature: string;
  /** The pinned 32-byte canonical hash. */
  jobSpecHash: Uint8Array;
  /** The pinned hosted URI. */
  jobSpecUri: string;
  /** Attestor detail passthrough (when the host leg ran). */
  moderation?: unknown;
}

/** Props for {@link TaskActivationRepair}. */
export interface TaskActivationRepairProps {
  /** The funded-but-unactivated Task PDA. */
  taskPda: string;
  /** The hired ServiceListing PDA (the activation route binds specs to it). */
  listing: string;
  /** Hex of the hire's 32-byte task id (optional; the route ignores it). */
  taskIdHex?: string | null;
  /**
   * The job-spec draft the hire intended to pin. When absent a generic
   * "as listed" draft is rebuilt — any CLEAN-attested spec can activate a
   * task that has none.
   */
  jobSpec?: StoreJobSpecDraft | null;
  /** The confirmed hire signature (audit passthrough). */
  hireSignature?: string | null;
  /** Whether the store referrer was injected into the hire. */
  referrerInjected?: boolean;
  /** Known canonical hash hex from a prior attempt (skips re-hosting). */
  jobSpecHashHex?: string | null;
  /** Known hosted URI from a prior attempt (skips re-hosting). */
  jobSpecUri?: string | null;
  /** The store's activation route. Defaults to the same-origin route. */
  activationEndpoint?: string;
  /** Called when the repair lands and the task is claimable. */
  onActivated?: (result: TaskActivationRepairResult) => void;
  /** Emit no theme classes (white-label). */
  unstyled?: boolean;
  /** Extra root class. */
  className?: string;
}

/**
 * The activation-repair panel: warning copy + a "Retry activation" button.
 *
 * @param props - {@link TaskActivationRepairProps}.
 */
export function TaskActivationRepair({
  taskPda,
  listing,
  taskIdHex,
  jobSpec,
  hireSignature,
  referrerInjected = false,
  jobSpecHashHex,
  jobSpecUri,
  activationEndpoint = DEFAULT_ACTIVATION_ROUTE,
  onActivated,
  unstyled,
  className,
}: TaskActivationRepairProps): ReactElement {
  const activation = useTaskActivation(
    taskPda as Parameters<typeof useTaskActivation>[0],
  );
  const [hostPending, setHostPending] = useState(false);
  const [hostError, setHostError] = useState<Error | null>(null);
  const [done, setDone] = useState(false);
  const inFlightRef = useRef(false);

  const retry = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setHostError(null);
    activation.reset();
    try {
      let hash =
        jobSpecHashHex && HASH_HEX_RE.test(jobSpecHashHex)
          ? hexToBytes(jobSpecHashHex.toLowerCase())
          : null;
      let uri = jobSpecUri ?? null;
      let moderation: unknown;
      if (!hash || !uri) {
        setHostPending(true);
        try {
          const host = createStoreActivationHost<StoreJobSpecDraft>({
            endpoint: activationEndpoint,
          });
          const taskId =
            taskIdHex && /^[0-9a-f]{64}$/i.test(taskIdHex)
              ? hexToBytes(taskIdHex.toLowerCase())
              : new Uint8Array(32);
          const result = await host({
            taskPda,
            taskId,
            listing,
            jobSpec: jobSpec ?? buildListingJobSpec({ listingName: listing }),
            hireSignature: hireSignature ?? "",
            referrerInjected,
          });
          hash = result.jobSpecHash;
          uri = result.jobSpecUri;
          moderation = result.moderation;
        } finally {
          setHostPending(false);
        }
      }
      if (!hash || !uri) {
        throw new Error("Activation host returned no job-spec pointer.");
      }
      const signature = await activation.activate({
        jobSpecHash: hash,
        jobSpecUri: uri,
      } as Parameters<typeof activation.activate>[0]);
      setDone(true);
      onActivated?.({
        taskPda,
        activationSignature: signature,
        jobSpecHash: hash,
        jobSpecUri: uri,
        moderation,
      });
    } catch (cause) {
      // Surface every failure through state (host leg or set_task_job_spec
      // leg alike) — never an unhandled rejection.
      setHostError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      inFlightRef.current = false;
    }
  }, [
    activation,
    activationEndpoint,
    hireSignature,
    jobSpec,
    jobSpecHashHex,
    jobSpecUri,
    listing,
    onActivated,
    referrerInjected,
    taskIdHex,
    taskPda,
  ]);

  const pending = hostPending || activation.isPending;
  const error = hostError ?? activation.error;

  if (done) {
    return (
      <div
        role="status"
        className={
          className ?? (unstyled ? undefined : "agenc agenc-activation-repair")
        }
        style={unstyled ? undefined : repairStyle}
      >
        Activation repaired — this task is now claimable by workers.
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={
        className ?? (unstyled ? undefined : "agenc agenc-activation-repair")
      }
      style={unstyled ? undefined : repairStyle}
    >
      <p style={unstyled ? undefined : { margin: 0 }}>
        <strong>This hire is funded but not yet activated.</strong> Its job
        spec is not pinned on-chain, so workers cannot claim it yet. Retrying
        only re-runs the activation — it never charges you again.
      </p>
      {error ? (
        <p
          style={
            unstyled
              ? undefined
              : { margin: 0, color: "var(--agenc-danger, #FF6B6B)" }
          }
        >
          {error.message}
        </p>
      ) : null}
      <div>
        <Button
          unstyled={unstyled}
          variant="primary"
          loading={pending}
          disabled={pending}
          onClick={() => void retry()}
        >
          {pending ? "Retrying activation…" : "Retry activation"}
        </Button>
      </div>
    </div>
  );
}

const repairStyle = {
  display: "grid",
  gap: "0.75rem",
  padding: "1rem",
  marginTop: "0.75rem",
  border: "1px solid var(--agenc-border, #2E1A4A)",
  borderLeft: "3px solid var(--agenc-warning, #E0B34C)",
  borderRadius: "var(--agenc-radius, 8px)",
  background: "var(--agenc-surface, #16102A)",
  color: "var(--agenc-text, #EDE7F8)",
} as const;
