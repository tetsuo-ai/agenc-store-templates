/**
 * Curation tests (PLAN_2 C2/C3): the full rule set ANDs filters, `exclude` wins,
 * and the server-side fast path only fires on a single provider/category.
 */
import { describe, it, expect } from "vitest";
import {
  applyCuration,
  curationToListingsFilter,
  curationIsActive,
  type CurateableListing,
} from "../src/config/curation.js";
import { curationSchema } from "../src/config/schema.js";
import { LISTING_A, LISTING_B, PROVIDER_A } from "./fixtures.js";

const OTHER_PROVIDER = "8iC21EoERDWSXRc5AH8fQBaV32pMSsAN3P7jumi15pH6";
const OTHER_LISTING = "7M2tYoUMwtumX8RVnXDtnV5ddqgnu8b8swS5HFytLxJE";

const listings: CurateableListing[] = [
  { address: LISTING_A, providerAgent: PROVIDER_A, category: "code-generation", rating: 4 },
  { address: LISTING_B, providerAgent: OTHER_PROVIDER, category: "data-analysis", rating: 2 },
  { address: OTHER_LISTING, providerAgent: PROVIDER_A, category: "code-generation", rating: 5 },
];

function curate(input: unknown) {
  return curationSchema.parse(input);
}

describe("applyCuration", () => {
  it("returns all listings when no curation is supplied", () => {
    expect(applyCuration(listings, undefined)).toHaveLength(3);
  });

  it("filters by category set", () => {
    const result = applyCuration(listings, curate({ categories: ["data-analysis"] }));
    expect(result.map((l) => l.address)).toEqual([LISTING_B]);
  });

  it("filters by provider set", () => {
    const result = applyCuration(listings, curate({ providers: [PROVIDER_A] }));
    expect(result.map((l) => l.address)).toEqual([LISTING_A, OTHER_LISTING]);
  });

  it("applies an include allowlist", () => {
    const result = applyCuration(listings, curate({ include: [LISTING_A] }));
    expect(result.map((l) => l.address)).toEqual([LISTING_A]);
  });

  it("exclude wins over include", () => {
    const result = applyCuration(
      listings,
      curate({ include: [LISTING_A, LISTING_B], exclude: [LISTING_A] }),
    );
    expect(result.map((l) => l.address)).toEqual([LISTING_B]);
  });

  it("ANDs multiple filters", () => {
    const result = applyCuration(
      listings,
      curate({ categories: ["code-generation"], providers: [PROVIDER_A] }),
    );
    expect(result.map((l) => l.address)).toEqual([LISTING_A, OTHER_LISTING]);
  });

  it("applies minRating but never hides a listing for a missing rating", () => {
    const withMissing: CurateableListing[] = [
      { address: LISTING_A, category: "x", rating: 4 },
      { address: LISTING_B, category: "x", rating: 1 },
      { address: OTHER_LISTING, category: "x", rating: null },
    ];
    const result = applyCuration(withMissing, curate({ minRating: 3 }));
    // LISTING_A passes (4≥3); LISTING_B filtered (1<3); OTHER kept (no rating).
    expect(result.map((l) => l.address).sort()).toEqual(
      [LISTING_A, OTHER_LISTING].sort(),
    );
  });
});

describe("curationToListingsFilter", () => {
  it("sets the single-provider fast path only when exactly one provider", () => {
    expect(curationToListingsFilter(curate({ providers: [PROVIDER_A] }))).toEqual({
      provider: PROVIDER_A,
    });
    expect(
      curationToListingsFilter(curate({ providers: [PROVIDER_A, OTHER_PROVIDER] })),
    ).toEqual({});
  });

  it("sets the single-category fast path only when exactly one category", () => {
    expect(
      curationToListingsFilter(curate({ categories: ["code-generation"] })),
    ).toEqual({ category: "code-generation" });
    expect(
      curationToListingsFilter(curate({ categories: ["a", "b"] })),
    ).toEqual({});
  });
});

describe("curationIsActive", () => {
  it("is false for an empty/default curation", () => {
    expect(curationIsActive(undefined)).toBe(false);
    expect(curationIsActive(curate({}))).toBe(false);
  });
  it("is true when any narrowing rule is present", () => {
    expect(curationIsActive(curate({ categories: ["x"] }))).toBe(true);
    expect(curationIsActive(curate({ exclude: [LISTING_A] }))).toBe(true);
    expect(curationIsActive(curate({ minRating: 4 }))).toBe(true);
  });
});
