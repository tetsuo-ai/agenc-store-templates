/**
 * `/` — the catalog page (PLAN_2 C3). SSR: emits the store-level schema.org
 * JSON-LD (`Store`/`WebSite`) so search + agent crawlers index the storefront,
 * then renders the client `<Catalog>` (grid + category filters + search). The
 * surface check runs first so a not-live cluster shows the explicit state, not
 * an empty grid.
 */
import { storeJsonLd, jsonLdScript } from "@tetsuo-ai/store-core/seo";
import { SurfaceNotDeployedSection } from "@/lib/sections";
import { storeConfig, seoContext } from "@/lib/config";
import { loadDeployedSurface } from "@/lib/store";
import { Catalog } from "./catalog";

// Always render fresh against the live book; do not cache the catalog page.
export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const surface = await loadDeployedSurface();
  const jsonLd = storeJsonLd(seoContext);

  return (
    <>
      <script
        type="application/ld+json"
        // schema.org JSON-LD for the storefront root.
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      {surface.deployed ? (
        <Catalog network={storeConfig.network} curation={storeConfig.curation} />
      ) : surface.reason === "mainnet-not-launched" ? (
        <SurfaceNotDeployedSection surface={surface} />
      ) : (
        // devnet/localnet with no live listings: render the client catalog so
        // its designed empty-state copy (with the seed hint) shows, and so it
        // recovers live as soon as listings appear without a reload.
        <Catalog network={storeConfig.network} curation={storeConfig.curation} />
      )}
    </>
  );
}
