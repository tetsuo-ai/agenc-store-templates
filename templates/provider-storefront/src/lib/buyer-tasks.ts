/**
 * Buyer task tracking for the wallet-gated `/dashboard` (PLAN_2 C3). The
 * dashboard needs NO server session — the buyer's hires are tracked locally
 * (the canonical source of truth is on-chain; this is just the buyer's "my
 * recent hires" pointer list).
 *
 * Each record is written THE MOMENT the hire lands (before activation) with
 * `activated: false` plus the repair context, and flipped to `activated: true`
 * when `set_task_job_spec` lands. A hire whose activation failed therefore
 * stays visible — and re-activatable — on `/dashboard` instead of silently
 * stranding a funded escrow.
 *
 * SSR-safe: every accessor guards `typeof window`. Backward compatible with
 * the previous plain-string task list (old entries surface as records with
 * `activated: undefined` = unknown).
 */
import type { StoreJobSpecDraft } from "@tetsuo-ai/store-core/activation";

const STORAGE_KEY = "agenc-store:buyer-tasks";

/** One tracked hire (most fields exist only for the activation repair path). */
export interface BuyerTaskRecord {
  /** The minted Task PDA. */
  taskPda: string;
  /** The hired ServiceListing PDA. */
  listing?: string;
  /** Hex of the hire's 32-byte task id. */
  taskIdHex?: string | null;
  /** The confirmed hire signature. */
  hireSignature?: string | null;
  /** Whether the store referrer was injected into the hire. */
  referrerInjected?: boolean;
  /** The job-spec draft the hire intended to pin. */
  jobSpec?: StoreJobSpecDraft | null;
  /**
   * Activation state: `true` once `set_task_job_spec` landed, `false` when the
   * hire landed but activation has not, `undefined` for legacy entries.
   */
  activated?: boolean;
  /** Canonical hash hex from a successful host+attest leg (repair shortcut). */
  jobSpecHashHex?: string | null;
  /** Hosted URI from a successful host+attest leg (repair shortcut). */
  jobSpecUri?: string | null;
}

function normalize(entry: unknown): BuyerTaskRecord | null {
  if (typeof entry === "string") return { taskPda: entry }; // legacy shape
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const record = entry as Record<string, unknown>;
    if (typeof record.taskPda === "string" && record.taskPda) {
      return record as unknown as BuyerTaskRecord;
    }
  }
  return null;
}

/** Read the buyer's tracked hires (most-recent first). */
export function getBuyerTaskRecords(): BuyerTaskRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalize)
      .filter((r): r is BuyerTaskRecord => r !== null);
  } catch {
    return [];
  }
}

/** Read the buyer's tracked task PDAs (most-recent first). */
export function getBuyerTasks(): string[] {
  return getBuyerTaskRecords().map((r) => r.taskPda);
}

function write(records: BuyerTaskRecord[]): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(records.slice(0, 100)),
    );
  } catch {
    /* storage full / disabled — non-fatal, the dashboard simply shows less */
  }
}

/**
 * Record a hire (deduped by task PDA, most-recent first). Accepts the plain
 * PDA string (legacy callers) or a full record — call it from `onHired` with
 * `activated: false` so a later activation failure cannot lose the task.
 */
export function addBuyerTask(task: string | BuyerTaskRecord): void {
  if (typeof window === "undefined") return;
  const record: BuyerTaskRecord =
    typeof task === "string" ? { taskPda: task } : task;
  const existing = getBuyerTaskRecords().filter(
    (r) => r.taskPda !== record.taskPda,
  );
  write([record, ...existing]);
}

/**
 * Mark a tracked hire as activated (its job spec is pinned; workers can
 * claim). Unknown PDAs are added rather than dropped — the on-chain task is
 * the source of truth.
 */
export function markBuyerTaskActivated(
  taskPda: string,
  detail?: { jobSpecHashHex?: string | null; jobSpecUri?: string | null },
): void {
  if (typeof window === "undefined") return;
  const records = getBuyerTaskRecords();
  const current = records.find((r) => r.taskPda === taskPda) ?? { taskPda };
  const updated: BuyerTaskRecord = {
    ...current,
    activated: true,
    jobSpecHashHex: detail?.jobSpecHashHex ?? current.jobSpecHashHex ?? null,
    jobSpecUri: detail?.jobSpecUri ?? current.jobSpecUri ?? null,
  };
  write([updated, ...records.filter((r) => r.taskPda !== taskPda)]);
}
