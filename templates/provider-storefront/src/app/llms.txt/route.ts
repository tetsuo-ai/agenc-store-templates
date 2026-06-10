/**
 * `/llms.txt` (PLAN_2 C3) — the agent-crawler manifest. Points crawlers at the
 * catalog and lists each curated listing with its detail/AgentCard URL, from the
 * shared `store-core/seo` builder. Served as `text/plain`. Returns 404 when
 * `seo.llmsTxt` is off.
 */
import { buildLlmsTxt } from "@tetsuo-ai/store-core/seo";
import { seoContext } from "@/lib/config";
import { loadStoreListings } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!seoContext.llmsTxt) {
    return new Response("Not found", { status: 404 });
  }
  const listings = await loadStoreListings();
  const body = buildLlmsTxt(seoContext, listings);
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
