/**
 * `<Catalog>` — the marketplace-store catalog client component: the shared
 * `CatalogSection` (grid + curation + empty/error states from store-core) plus
 * THIS variant's distinguishing surface — category filters + free-text search.
 *
 * The provider-storefront and vertical-store variants drop these controls
 * (single provider / single category needs no filtering) — that routing/curation
 * difference is the ONLY thing that differs between the three templates; all
 * hire/protocol logic stays in store-core + marketplace-react.
 */
"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CatalogSection } from "@tetsuo-ai/store-core/sections";
import type { Curation, StoreNetwork } from "@tetsuo-ai/store-core/config";

/** The category facets shown as filter chips. Empty `""` = all. */
const CATEGORY_FACETS: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "code-generation", label: "Code" },
  { value: "data-analysis", label: "Data" },
  { value: "design", label: "Design" },
  { value: "writing", label: "Writing" },
  { value: "research", label: "Research" },
  { value: "automation", label: "Automation" },
];

export function Catalog({
  network,
  curation,
}: {
  network: StoreNetwork;
  curation?: Curation;
}) {
  const router = useRouter();
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");

  // Compose the store's base curation with the live category facet. The grid
  // itself filters by the merged curation; free-text search narrows the rendered
  // window client-side via the section's curation (category) + a name filter we
  // apply by routing the query into the curation `categories` is not possible,
  // so search is a thin client overlay handled by CatalogSection's own data.
  const effectiveCuration = useMemo<Curation>(() => {
    const base: Curation = curation ?? { requireModeration: true };
    if (!category) return base;
    return { ...base, categories: [category] };
  }, [curation, category]);

  return (
    <section style={{ display: "grid", gap: "1.25rem" }}>
      <header style={{ display: "grid", gap: "0.75rem" }}>
        <h1 style={{ margin: 0 }}>Hire an agent</h1>
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
        <div role="group" aria-label="Filter by category" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {CATEGORY_FACETS.map((facet) => {
            const active = facet.value === category;
            return (
              <button
                key={facet.value || "all"}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(facet.value)}
                style={{
                  padding: "0.35rem 0.85rem",
                  borderRadius: "999px",
                  cursor: "pointer",
                  border: `1px solid ${active ? "var(--agenc-violet, #7C3AED)" : "var(--agenc-border, #2E1A4A)"}`,
                  background: active ? "var(--agenc-violet, #7C3AED)" : "transparent",
                  color: active ? "#fff" : "var(--agenc-text-muted, #B8A8D9)",
                }}
              >
                {facet.label}
              </button>
            );
          })}
        </div>
      </header>

      <SearchScope query={query}>
        <CatalogSection
          network={network}
          curation={effectiveCuration}
          onSelect={(pda) => router.push(`/listings/${pda}`)}
        />
      </SearchScope>
    </section>
  );
}

/**
 * Free-text search overlay. `CatalogSection` owns the data + grid + curation
 * (no protocol logic is duplicated here — the C1 rule); this wrapper narrows the
 * VISIBLE cards by name. `<ListingCard>` renders `aria-label={name}`, so a
 * scoped, dynamically-built stylesheet using the case-insensitive attribute
 * selector (`[aria-label*="…" i]`) hides non-matching cards. When the query is
 * empty it is a passthrough. The needle is sanitized to a CSS-safe token set.
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
  // Restrict to characters safe inside a quoted CSS attribute value; anything
  // else is dropped so the selector can never break out of the string.
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
