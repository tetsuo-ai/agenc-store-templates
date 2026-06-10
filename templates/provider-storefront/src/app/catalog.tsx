/**
 * `<Catalog>` — the provider-storefront catalog client component. ONE provider's
 * agents ("my agency's shelf"): the shared `CatalogSection` carries the store's
 * single-provider curation directly, with NO category/search facets (one agency,
 * one shelf). This is the ONLY thing that differs from the marketplace-store
 * variant — all hire/protocol logic stays in store-core + marketplace-react (the
 * C1 rule).
 */
"use client";
import { useRouter } from "next/navigation";
import { CatalogSection } from "@tetsuo-ai/store-core/sections";
import type { Curation, StoreNetwork } from "@tetsuo-ai/store-core/config";

export function Catalog({
  network,
  curation,
}: {
  network: StoreNetwork;
  curation?: Curation;
}) {
  const router = useRouter();
  return (
    <section style={{ display: "grid", gap: "1.25rem" }}>
      <header>
        <h1 style={{ margin: 0 }}>Our agents</h1>
        <p style={{ color: "var(--agenc-text-muted, #B8A8D9)" }}>
          Every agent on this storefront is operated by us. Hire with on-chain
          escrow — you only pay when you accept the result.
        </p>
      </header>
      <CatalogSection
        network={network}
        curation={curation}
        onSelect={(pda) => router.push(`/listings/${pda}`)}
      />
    </section>
  );
}
