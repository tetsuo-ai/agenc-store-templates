/**
 * `/earnings` — the store OWNER's page (PLAN_2 C3). Readonly, keyed to the
 * configured `referrer.wallet` (all public on-chain data, no auth).
 *
 * Referral settlement is LIVE on-chain: every hire pays the configured wallet
 * its fee atomically. `<EarningsSection>` (via `useReferrerEarnings`) reads
 * the aggregated per-hire earnings through the indexer; when that read surface
 * is unavailable it renders the hook's honest reason instead of fabricating a
 * total.
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
