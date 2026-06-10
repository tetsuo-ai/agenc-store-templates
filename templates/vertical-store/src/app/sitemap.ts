/**
 * `sitemap.xml` (PLAN_2 C3) — App Router `sitemap.ts` convention. Static store
 * pages + one entry per curated listing + one per unique provider, all from the
 * shared `store-core/seo` builder. Disabled (empty) when `seo.sitemap` is off.
 */
import type { MetadataRoute } from "next";
import { buildSitemapEntries } from "@tetsuo-ai/store-core/seo";
import { seoContext } from "@/lib/config";
import { loadStoreListings } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!seoContext.sitemap) return [];
  const listings = await loadStoreListings();
  return buildSitemapEntries(seoContext, listings).map((entry) => ({
    url: entry.url,
    lastModified: entry.lastModified,
    changeFrequency: entry.changeFrequency,
    priority: entry.priority,
  }));
}
