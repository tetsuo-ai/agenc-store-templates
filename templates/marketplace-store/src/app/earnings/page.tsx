/**
 * `/earnings` — the store OWNER's page (PLAN_2 C3). Readonly, keyed to the
 * configured `referrer.wallet`. Runtime-only (the earnings read is a live hook),
 * so this server shell sets `dynamic` and renders the client body.
 *
 * Referral settlement is live on-chain; the client body reads earnings through
 * the indexer and renders an honest reason (never a fabricated total) when
 * that read surface is unavailable.
 */
import { EarningsClient } from "./earnings-client";

export const dynamic = "force-dynamic";

export default function EarningsPage() {
  return <EarningsClient />;
}
