/**
 * `/trust` — the buyer-protection explainer (PLAN_2 C3). Escrow, completion
 * bonds, disputes; the moderation policy; and the fee disclosure (protocol +
 * operator + THIS store's referral bps + wallet), mirroring the checkout
 * disclosure so the earning party is always visible. Links to the credible-exit
 * doc (PLAN.md P8.6).
 *
 * The referral disclosure uses the provider capability's `live` flag — true
 * whenever a validated referrer is configured (referral settlement is live
 * on-chain), so the buyer sees the present-tense fee copy.
 *
 * Client component: `validateReferrerConfig` / `resolveReferrerCapability` +
 * `TrustSection` come from the `marketplace-react` client bundle.
 */
"use client";
import {
  validateReferrerConfig,
  resolveReferrerCapability,
} from "@tetsuo-ai/marketplace-react";
import { TrustSection } from "@/lib/sections";
import { storeConfig } from "@/lib/config";

export function TrustClient() {
  // Validate the configured referrer into the branded form the disclosure reads
  // (the config already passed `defineStore`'s base58 + range validation).
  const referrer = validateReferrerConfig(storeConfig.referrer);
  // Capability: `live` is true whenever a validated referrer is configured —
  // referral settlement is live on-chain.
  const capability = resolveReferrerCapability(referrer);

  return (
    <TrustSection
      storeName={storeConfig.name}
      referrer={referrer}
      referrerLive={capability.live}
    />
  );
}
