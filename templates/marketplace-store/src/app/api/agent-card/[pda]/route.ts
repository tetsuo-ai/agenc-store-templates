/**
 * `/api/agent-card/[pda]` (PLAN_2 C3) — the per-listing machine-readable
 * AgentCard JSON (schema `agenc.agentCard.v1`, unified with agenc.ag's
 * production card). Lets agent crawlers discover and act on one listing
 * (identity, price, store attribution incl. the referral fee, hireability).
 * Built from the shared `store-core/seo` `listingAgentCard` helper. Returns
 * 404 when the listing is not found.
 */
import { listingAgentCard } from "@tetsuo-ai/store-core/seo";
import { seoContext } from "@/lib/config";
import { storeConfig } from "@/lib/config";
import { loadListing } from "@/lib/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pda: string }> };

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const { pda } = await params;
  const listing = await loadListing(pda);
  if (!listing) {
    return Response.json(
      { error: "listing not found" },
      { status: 404, headers: { "access-control-allow-origin": "*" } },
    );
  }
  return Response.json(
    listingAgentCard(listing, seoContext, {
      referrerFeeBps: storeConfig.referrer.feeBps,
    }),
    { headers: { "access-control-allow-origin": "*" } },
  );
}
