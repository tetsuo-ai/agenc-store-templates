/**
 * URL + price helpers shared across the SEO emitters (PLAN_2 C3).
 *
 * @module seo/url
 */

/** Lamports per SOL. */
export const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Strip a single trailing slash from a site origin so joins are clean. */
export function normalizeSiteUrl(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, "");
}

/**
 * Join a site origin with a path, normalizing slashes. Absolute `path` values
 * are returned unchanged.
 *
 * @param siteUrl - The canonical origin.
 * @param path - A path (with or without a leading slash) or an absolute URL.
 */
export function absoluteUrl(siteUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = normalizeSiteUrl(siteUrl);
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** The canonical store-relative path for a listing detail page. */
export function listingPath(pda: string): string {
  return `/listings/${pda}`;
}

/** The canonical store-relative path for a provider page. */
export function providerPath(pda: string): string {
  return `/providers/${pda}`;
}

/**
 * Convert a lamport amount (u64-safe `bigint | string | number`) to a decimal
 * SOL string with up to 9 fractional digits, trailing zeros trimmed.
 *
 * @param lamports - The lamport amount.
 * @returns A SOL decimal string (e.g. `"0.001"`), or `"0"` for falsy input.
 */
export function lamportsToSol(
  lamports: bigint | string | number | undefined | null,
): string {
  if (lamports === undefined || lamports === null) return "0";
  let value: bigint;
  try {
    value = typeof lamports === "bigint" ? lamports : BigInt(String(lamports));
  } catch {
    return "0";
  }
  const whole = value / LAMPORTS_PER_SOL;
  const frac = value % LAMPORTS_PER_SOL;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr}`;
}
