/**
 * `/listings/[pda]` — the listing detail page (PLAN_2 C3). THIS is the per-store
 * SEO surface (P10.3, shipped per-store instead of only on the central
 * marketplace): SSR-rendered with schema.org `Service`/`Offer` JSON-LD + OG/meta
 * via `generateMetadata`, then the interactive `<ListingDetail>` body (spec,
 * price, provider track record, moderation badge, HireButton).
 */
import type { Metadata } from "next";
import {
  listingJsonLd,
  listingMetadata,
  jsonLdScript,
} from "@tetsuo-ai/store-core/seo";
import { seoContext } from "@/lib/config";
import { loadListing } from "@/lib/store";
import { ListingDetail } from "./detail";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pda: string }> };

/** Per-listing OG + canonical + Twitter metadata (the SEO surface). */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { pda } = await params;
  const listing = await loadListing(pda);
  if (!listing) {
    return { title: `Listing not found — ${seoContext.name}` };
  }
  return listingMetadata(listing, seoContext);
}

export default async function ListingPage({ params }: Params) {
  const { pda } = await params;
  const listing = await loadListing(pda);

  return (
    <>
      {listing ? (
        <script
          type="application/ld+json"
          // schema.org Service + Offer JSON-LD for this listing.
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(listingJsonLd(listing, seoContext)),
          }}
        />
      ) : null}
      <ListingDetail pda={pda} />
    </>
  );
}
