/**
 * `/trust` — the buyer-protection explainer (PLAN_2 C3). The referral disclosure
 * is computed client-side (it uses the `marketplace-react` validator), so this
 * server shell renders the client body. It can be statically rendered, but we
 * keep it dynamic for consistency with the other interactive routes.
 */
import { TrustClient } from "./trust-client";

export const dynamic = "force-dynamic";

export default function TrustPage() {
  return <TrustClient />;
}
