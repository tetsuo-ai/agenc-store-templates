/**
 * `/api/agent-card/[pda]` (PLAN_2 C3) — the per-listing machine-readable
 * AgentCard JSON. Lets agent crawlers discover and act on one listing (name,
 * price, the hire action target). Built from the shared `store-core/seo`
 * `listingAgentCard` helper. Returns 404 when the listing is not found.
 */
import { listingAgentCard } from "@tetsuo-ai/store-core/seo";
import { seoContext } from "@/lib/config";
import { loadListing } from "@/lib/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pda: string }> };

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const { pda } = await params;
  const listing = await loadListing(pda);
  if (!listing) {
    return Response.json({ error: "listing not found" }, { status: 404 });
  }
  return Response.json(listingAgentCard(listing, seoContext));
}
