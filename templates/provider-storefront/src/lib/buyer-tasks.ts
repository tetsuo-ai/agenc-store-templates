/**
 * Buyer task tracking for the wallet-gated `/dashboard` (PLAN_2 C3). The
 * dashboard needs NO server session — the buyer's task PDAs are tracked locally
 * (the canonical source of truth is on-chain; this is just the buyer's "my
 * recent hires" pointer list). When a hire settles, the listing detail page
 * records the minted task PDA here.
 *
 * SSR-safe: every accessor guards `typeof window`.
 */
const STORAGE_KEY = "agenc-store:buyer-tasks";

/** Read the buyer's tracked task PDAs (most-recent first). */
export function getBuyerTasks(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Record a newly-minted task PDA (deduped, most-recent first). */
export function addBuyerTask(taskPda: string): void {
  if (typeof window === "undefined") return;
  const existing = getBuyerTasks().filter((p) => p !== taskPda);
  const next = [taskPda, ...existing].slice(0, 100);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage full / disabled — non-fatal, the dashboard simply shows less */
  }
}
