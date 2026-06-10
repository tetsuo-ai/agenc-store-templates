/**
 * `/dashboard` — the buyer's task dashboard (PLAN_2 C3). Wallet-gated,
 * client-side, with NO server session — so it is a runtime-only route (never
 * statically prerendered). This server shell sets `dynamic` and renders the
 * client body.
 */
import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return <DashboardClient />;
}
