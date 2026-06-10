/**
 * `robots.txt` (PLAN_2 C3) — App Router `robots.ts` convention. Allows all
 * crawlers and points at the sitemap. The `# Agent manifest: …/llms.txt` line
 * from the store-core builder is preserved as a host comment.
 */
import type { MetadataRoute } from "next";
import { normalizeSiteUrl } from "@tetsuo-ai/store-core/seo";
import { seoContext } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  const base = normalizeSiteUrl(seoContext.siteUrl);
  return {
    rules: { userAgent: "*", allow: "/" },
    ...(seoContext.sitemap ? { sitemap: `${base}/sitemap.xml` } : {}),
  };
}
