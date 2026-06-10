/**
 * `sitemap.xml` + `robots.txt` emitters (PLAN_2 C3). Pure string builders — a
 * template wires them into App Router `sitemap.ts` / `robots.ts` (or a raw
 * route handler). Agent + search crawlers discover the store's supply from
 * these plus `/llms.txt`.
 *
 * @module seo/sitemap
 */
import type { SeoListing, SeoStoreContext } from "./types.js";
import {
  absoluteUrl,
  listingPath,
  normalizeSiteUrl,
  providerPath,
} from "./url.js";

/** One sitemap URL entry. */
export interface SitemapEntry {
  url: string;
  lastModified?: string;
  changeFrequency?:
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";
  priority?: number;
}

/** XML-escape a string for safe inclusion in `<loc>`. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build the structured sitemap entry list (the App Router `sitemap.ts` return
 * shape). Static store pages first, then a detail entry per listing and a
 * provider entry per unique provider.
 *
 * @param store - Store context.
 * @param listings - The (curated) listings to include.
 * @returns An array of {@link SitemapEntry}.
 */
export function buildSitemapEntries(
  store: SeoStoreContext,
  listings: readonly SeoListing[],
): SitemapEntry[] {
  const base = normalizeSiteUrl(store.siteUrl);
  const now = new Date().toISOString();

  const staticPaths: Array<[string, number]> = [
    ["/", 1.0],
    ["/trust", 0.5],
    ["/dashboard", 0.3],
    ["/earnings", 0.3],
  ];

  const entries: SitemapEntry[] = staticPaths.map(([path, priority]) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority,
  }));

  for (const listing of listings) {
    entries.push({
      url: absoluteUrl(store.siteUrl, listingPath(listing.pda)),
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    });
  }

  const seenProviders = new Set<string>();
  for (const listing of listings) {
    if (!listing.provider || seenProviders.has(listing.provider)) continue;
    seenProviders.add(listing.provider);
    entries.push({
      url: absoluteUrl(store.siteUrl, providerPath(listing.provider)),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  return entries;
}

/**
 * Render the sitemap entries as a `sitemap.xml` string (for templates that emit
 * a raw route handler rather than App Router `sitemap.ts`).
 *
 * @param entries - The sitemap entries.
 * @returns A complete XML document string.
 */
export function renderSitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries
    .map((entry) => {
      const parts = [`    <loc>${xmlEscape(entry.url)}</loc>`];
      if (entry.lastModified) {
        parts.push(`    <lastmod>${xmlEscape(entry.lastModified)}</lastmod>`);
      }
      if (entry.changeFrequency) {
        parts.push(`    <changefreq>${entry.changeFrequency}</changefreq>`);
      }
      if (typeof entry.priority === "number") {
        parts.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
      }
      return `  <url>\n${parts.join("\n")}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * Build the `robots.txt` content. Allows all crawlers, points at the sitemap.
 *
 * @param store - Store context.
 * @returns The `robots.txt` body.
 */
export function buildRobotsTxt(store: SeoStoreContext): string {
  const base = normalizeSiteUrl(store.siteUrl);
  const lines = ["User-agent: *", "Allow: /"];
  if (store.sitemap) lines.push(`Sitemap: ${base}/sitemap.xml`);
  if (store.llmsTxt) lines.push(`# Agent manifest: ${base}/llms.txt`);
  return `${lines.join("\n")}\n`;
}
