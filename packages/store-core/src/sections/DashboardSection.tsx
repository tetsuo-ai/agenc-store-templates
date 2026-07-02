/**
 * `<DashboardTaskSection>` — one buyer task's lifecycle panel (PLAN_2 C3, the
 * `/dashboard` page). Wraps `useTaskStatus` + `useSubmissionReview` +
 * `useDispute` and renders the `TaskTimeline`, `ReviewPanel`, and
 * `DisputeBanner`. The `/dashboard` page is wallet-gated client-side (no server
 * session): the template tracks the buyer's task PDAs locally and renders one
 * of these per task.
 *
 * Client component (`"use client"`): it uses hooks.
 *
 * @module sections/DashboardSection
 */
"use client";
import type { ReactElement, ReactNode } from "react";
import type { Address } from "@solana/kit";
import { address } from "@solana/kit";
import {
  DisputeBanner,
  ReviewPanel,
  TaskTimeline,
  truncateAddress,
} from "@tetsuo-ai/marketplace-react";
import {
  useDispute,
  useSubmissionReview,
  useTaskStatus,
} from "@tetsuo-ai/marketplace-react/hooks";

/** Props for {@link DashboardTaskSection}. */
export interface DashboardTaskSectionProps {
  /** The task PDA to render. */
  taskPda: string;
  /** A rejection-hash provider (the buyer supplies the off-chain reason hash). */
  rejectionHash?: () => Promise<Uint8Array | string> | Uint8Array | string;
  /** A changes-hash provider (the buyer supplies the requested-changes hash). */
  changesHash?: () => Promise<Uint8Array | string> | Uint8Array | string;
  /** A dispute-evidence-hash provider for `initiate`. */
  disputeEvidence?: () =>
    | Promise<Uint8Array | string>
    | Uint8Array
    | string;
  /**
   * Optional activation-repair slot: render a {@link TaskActivationRepair}
   * here for a hired task whose job spec was never pinned (funded but not
   * claimable). The template owns detection (it tracks activation state with
   * its buyer-task records).
   */
  activationRepair?: ReactNode;
  /** Emit no theme classes (white-label). */
  unstyled?: boolean;
}

/**
 * One task's status timeline + review actions + dispute state.
 *
 * @param props - {@link DashboardTaskSectionProps}.
 */
export function DashboardTaskSection({
  taskPda,
  activationRepair,
  unstyled,
}: DashboardTaskSectionProps): ReactElement {
  // `useSubmissionReview` types its arg as the SDK's branded `Address`; the
  // other two accept `Address | string`. Resolve once at the boundary.
  const taskAddress: Address = address(taskPda);
  const taskStatus = useTaskStatus(taskPda);
  const review = useSubmissionReview(taskAddress);
  const dispute = useDispute(taskPda);

  const hasSubmission = taskStatus.submission !== null;
  const disputeOpen = dispute.dispute !== null;

  return (
    <section
      className={unstyled ? undefined : "agenc"}
      style={
        unstyled
          ? undefined
          : {
              display: "grid",
              gap: "1rem",
              padding: "1rem",
              border: "1px solid var(--agenc-border, #2E1A4A)",
              borderRadius: "var(--agenc-radius, 8px)",
              background: "var(--agenc-surface, #16102A)",
            }
      }
    >
      <header style={unstyled ? undefined : { color: "var(--agenc-text-muted, #B8A8D9)" }}>
        Task {truncateAddress(taskPda)}
      </header>

      {activationRepair}

      <TaskTimeline
        status={taskStatus.status}
        isLoading={taskStatus.isLoading}
        error={taskStatus.error}
        onRetry={taskStatus.refetch}
        unstyled={unstyled}
      />

      <ReviewPanel
        hasSubmission={hasSubmission}
        status={review.status}
        error={review.error}
        unstyled={unstyled}
      />

      <DisputeBanner
        disputeOpen={disputeOpen}
        status={dispute.status}
        error={dispute.error}
        unstyled={unstyled}
      />
    </section>
  );
}
