/**
 * `/dashboard` — the buyer's task dashboard (PLAN_2 C3). Wallet-gated
 * client-side: NO server session. The buyer's hires are tracked locally
 * (`buyer-tasks`, recorded the moment each hire lands); each renders a shared
 * `<DashboardTaskSection>` (status timeline + ReviewPanel + dispute state).
 *
 * Hires recorded with `activated: false` (the hire landed but the job-spec
 * pin failed) additionally render a `<TaskActivationRepair>` panel: the task
 * is funded but not claimable by workers until the buyer retries the
 * activation — retrying never charges again.
 *
 * `"use client"` for the local task list + hooks. Marked dynamic so it is never
 * statically prerendered.
 */
"use client";
import { useEffect, useState } from "react";
import { DashboardTaskSection, TaskActivationRepair } from "@/lib/sections";
import { StateMessage } from "@tetsuo-ai/marketplace-react";
import {
  getBuyerTaskRecords,
  markBuyerTaskActivated,
  type BuyerTaskRecord,
} from "@/lib/buyer-tasks";

export function DashboardClient() {
  // Read tracked tasks AFTER mount so SSR + first client render match (no
  // hydration mismatch); localStorage is unavailable on the server.
  const [tasks, setTasks] = useState<BuyerTaskRecord[] | null>(null);
  useEffect(() => {
    setTasks(getBuyerTaskRecords());
  }, []);

  return (
    <section style={{ display: "grid", gap: "1.25rem" }}>
      <header>
        <h1 style={{ margin: 0 }}>My tasks</h1>
        <p style={{ color: "var(--agenc-text-muted, #B8A8D9)" }}>
          Hires you have funded from this store. Review and accept results, or
          open a dispute. This list is kept in your browser; the source of truth
          is on-chain.
        </p>
      </header>

      {tasks === null ? (
        <StateMessage kind="loading" />
      ) : tasks.length === 0 ? (
        <StateMessage
          kind="empty"
          message="You haven't hired any agents from this store yet. Browse the catalog to get started."
        />
      ) : (
        <div style={{ display: "grid", gap: "1rem" }}>
          {tasks.map((record) => (
            <DashboardTaskSection
              key={record.taskPda}
              taskPda={record.taskPda}
              activationRepair={
                record.activated === false && record.listing ? (
                  <TaskActivationRepair
                    taskPda={record.taskPda}
                    listing={record.listing}
                    taskIdHex={record.taskIdHex}
                    jobSpec={record.jobSpec}
                    hireSignature={record.hireSignature}
                    referrerInjected={record.referrerInjected ?? false}
                    jobSpecHashHex={record.jobSpecHashHex}
                    jobSpecUri={record.jobSpecUri}
                    onActivated={(result) => {
                      markBuyerTaskActivated(result.taskPda, {
                        jobSpecUri: result.jobSpecUri,
                      });
                      setTasks(getBuyerTaskRecords());
                    }}
                  />
                ) : null
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
