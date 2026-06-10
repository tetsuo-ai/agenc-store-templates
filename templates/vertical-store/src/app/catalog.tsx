/**
 * `<Catalog>` — the vertical-store catalog client component. ONE curated
 * category (e.g. code review): the shared `CatalogSection` carries the store's
 * single-category curation, with free-text SEARCH but NO category facets (the
 * category is fixed by config). This is the ONLY thing that differs from the
 * marketplace-store variant — all hire/protocol logic stays in store-core +
 * marketplace-react (the C1 rule).
 */
"use client";
import { useState } from "react";
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
  const [query, setQuery] = useState("");

  return (
    <section style={{ display: "grid", gap: "1.25rem" }}>
      <header style={{ display: "grid", gap: "0.75rem" }}>
        <h1 style={{ margin: 0 }}>Specialist agents</h1>
        <p style={{ color: "var(--agenc-text-muted, #B8A8D9)", margin: 0 }}>
          A focused store — one category, vetted agents. Hire with on-chain
          escrow.
        </p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search agents by name…"
          aria-label="Search agents"
          style={{
            padding: "0.6rem 0.9rem",
            borderRadius: "var(--agenc-radius, 8px)",
            border: "1px solid var(--agenc-border, #2E1A4A)",
            background: "var(--agenc-surface, #16102A)",
            color: "var(--agenc-text, #F5F0FF)",
            maxWidth: "28rem",
          }}
        />
      </header>

      <SearchScope query={query}>
        <CatalogSection
          network={network}
          curation={curation}
          onSelect={(pda) => router.push(`/listings/${pda}`)}
        />
      </SearchScope>
    </section>
  );
}

/**
 * Free-text search overlay — narrows the VISIBLE cards by name without
 * re-implementing data/protocol logic (the C1 rule). `<ListingCard>` renders
 * `aria-label={name}`, so a scoped stylesheet with the case-insensitive
 * attribute selector hides non-matching cards. Passthrough when empty; the
 * needle is sanitized to a CSS-safe token set.
 */
function SearchScope({
  query,
  children,
}: {
  query: string;
  children: React.ReactNode;
}) {
  const needle = query.trim();
  if (!needle) return <>{children}</>;
  const safe = needle.replace(/["\\\n\r]/g, "").slice(0, 64);
  const scopeId = "agenc-search-scope";
  const css = `
    #${scopeId} .agenc-listing-card { display: none; }
    #${scopeId} .agenc-listing-card[aria-label*="${safe}" i] { display: revert; }
  `;
  return (
    <div id={scopeId}>
      <style>{css}</style>
      {children}
    </div>
  );
}
