/**
 * `/earnings` — the store OWNER's page (PLAN_2 C3). Readonly, keyed to the
 * configured `referrer.wallet`. Runtime-only (the earnings read is a live hook),
 * so this server shell sets `dynamic` and renders the client body.
 *
 * THE P6.2 GATE: the on-chain referrer settlement leg is not deployed, so the
 * client body renders the documented NOT-LIVE state and never fabricates a total.
 */
import { EarningsClient } from "./earnings-client";

export const dynamic = "force-dynamic";

export default function EarningsPage() {
  return <EarningsClient />;
}
