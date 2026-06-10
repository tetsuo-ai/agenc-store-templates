/**
 * `/earnings` — the store OWNER's page (PLAN_2 C3). Readonly, keyed to the
 * configured `referrer.wallet` (all public on-chain data, no auth).
 *
 * ## THE P6.2 GATE (PLAN_2 §0)
 *
 * The on-chain referrer settlement leg is NOT deployed. `<EarningsSection>`
 * (via `useReferrerEarnings`) renders the documented NOT-LIVE state today —
 * "referral earnings are not live yet, pending protocol support". It never
 * fabricates a total. When P6.2 ships, only the hook's capability flag flips
 * and the per-hire table renders real data with no code change here.
 */
"use client";
import { EarningsSection } from "@/lib/sections";
import { storeConfig } from "@/lib/config";

export function EarningsClient() {
  return (
    <EarningsSection
      referrerWallet={storeConfig.referrer.wallet}
      feeBps={storeConfig.referrer.feeBps}
    />
  );
}
