/**
 * Open Graph + meta-tag helpers (PLAN_2 C3). Returns a Next.js-`Metadata`-shaped
 * object (the App Router `generateMetadata` return type), so a template can
 * `return storeMetadata(...)` directly. The shape is structural, so store-core
 * needs no `next` dependency.
 *
 * @module seo/meta
 */
import type { SeoListing, SeoStoreContext } from "./types.js";
import { absoluteUrl, lamportsToSol, listingPath } from "./url.js";

/** A structural subset of Next.js `Metadata` (no `next` import needed). */
export interface PageMetadata {
  title: string;
  description: string;
  alternates?: { canonical: string };
  openGraph?: {
    title: string;
    description: string;
    url: string;
    siteName: string;
    type: string;
    images?: Array<{ url: string }>;
  };
  twitter?: {
    card: "summary" | "summary_large_image";
    title: string;
    description: string;
    images?: string[];
  };
}

function ogImages(ogImage?: string): Array<{ url: string }> | undefined {
  return ogImage ? [{ url: ogImage }] : undefined;
}

/**
 * Metadata for the store root / catalog page.
 *
 * @param store - Store context.
 * @returns A {@link PageMetadata} object.
 */
export function storeMetadata(store: SeoStoreContext): PageMetadata {
  const images = ogImages(store.ogImage);
  return {
    title: store.name,
    description: store.description,
    alternates: { canonical: store.siteUrl },
    openGraph: {
      title: store.name,
      description: store.description,
      url: store.siteUrl,
      siteName: store.name,
      type: "website",
      ...(images ? { images } : {}),
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: store.name,
      description: store.description,
      ...(store.ogImage ? { images: [store.ogImage] } : {}),
    },
  };
}

/**
 * Metadata for a listing detail page.
 *
 * @param listing - The listing projection.
 * @param store - Store context.
 * @returns A {@link PageMetadata} object.
 */
export function listingMetadata(
  listing: SeoListing,
  store: SeoStoreContext,
): PageMetadata {
  const url = absoluteUrl(store.siteUrl, listingPath(listing.pda));
  const priceSol = lamportsToSol(listing.priceLamports);
  const title = `${listing.name} — ${store.name}`;
  const description =
    listing.description ??
    `Hire ${listing.name}${listing.category ? ` (${listing.category})` : ""} for ${priceSol} SOL on ${store.name}.`;
  const images = ogImages(store.ogImage);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: store.name,
      type: "website",
      ...(images ? { images } : {}),
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title,
      description,
      ...(store.ogImage ? { images: [store.ogImage] } : {}),
    },
  };
}
