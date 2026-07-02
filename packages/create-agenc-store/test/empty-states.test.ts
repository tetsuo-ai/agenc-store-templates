/**
 * Empty/error-state logic test (PLAN_2 C3 Done-when: "each specced empty/error
 * state renders").
 *
 * The store sections render four DISTINCT designed states, chosen by the
 * surface-check + curation logic in `store-core/config`:
 *  - SurfaceNotDeployed (mainnet config missing its allowMainnet opt-in, no
 *    listings, or unreachable),
 *  - EmptyCatalog (devnet/localnet, genuinely no supply),
 *  - ZeroMatch (there IS supply, but curation matched nothing),
 *  - IndexerUnreachable (transport error).
 *
 * This asserts the DECISION that selects each state (the rendering itself is a
 * thin StateMessage wrapper; a browser render is browser-gated). The selection
 * is what must never regress — e.g. "no supply" must never be shown as "filters
 * matched nothing", or an owner would chase a phantom config bug.
 */
import { describe, expect, it } from "vitest";
import { address } from "@solana/kit";
import {
  getDeployedSurface,
  applyCuration,
  curationIsActive,
  safeDefineStore,
  type Curation,
  type CurateableListing,
} from "@tetsuo-ai/store-core/config";

function makeConfig(network: "localnet" | "devnet" | "mainnet", allowMainnet = false) {
  const result = safeDefineStore({
    name: "X",
    description: "d",
    network,
    ...(allowMainnet ? { allowMainnet: true } : {}),
    api: { baseUrl: "http://127.0.0.1:8899" },
    referrer: { wallet: "8iC21EoERDWSXRc5AH8fQBaV32pMSsAN3P7jumi15pH6", feeBps: 250 },
    seo: { siteUrl: "http://localhost:3000" },
  });
  if (!result.success) throw new Error(result.error.message);
  return result.config;
}

// Realistic base58 PDAs (so the curation `providers`/`include` Address typing is
// satisfied without casts; `applyCuration` compares via String()).
const P1 = "H66R3iFjeYj2sweCiFuJXNHz2NhjpFDHKjRNsPznDLC8";
const P2 = "8iC21EoERDWSXRc5AH8fQBaV32pMSsAN3P7jumi15pH6";
const A1 = "7RkbpXC7sPVNYSLVkaxChHgXNa4J8B4kgBhzRZzjTkHc";
const A2 = "2MotDCzC2HR8JstEze45p6ZyJYCzKFuAytGwLVmnopzB";

const listings: CurateableListing[] = [
  { address: A1, providerAgent: P1, category: "code-generation" },
  { address: A2, providerAgent: P2, category: "design" },
];

describe("SurfaceNotDeployed selection (getDeployedSurface)", () => {
  it("mainnet without allowMainnet → not-enabled WITHOUT a network call", async () => {
    // The build rejects mainnet without allowMainnet; the runtime surface guard
    // is defense-in-depth for a hand-edited deploy env. Build a valid mainnet
    // config (allowMainnet: true) then strip the flag to simulate that case.
    const config = { ...makeConfig("mainnet", true), allowMainnet: false };
    const surface = await getDeployedSurface(config, {
      listActiveListings: async () => {
        throw new Error("should not be called for the mainnet gate");
      },
    });
    expect(surface.deployed).toBe(false);
    if (!surface.deployed) expect(surface.reason).toBe("mainnet-not-enabled");
  });

  it("zero listings → no-listings", async () => {
    const surface = await getDeployedSurface(makeConfig("localnet"), {
      listActiveListings: async () => [],
    });
    expect(surface.deployed).toBe(false);
    if (!surface.deployed) expect(surface.reason).toBe("no-listings");
  });

  it("a probe error → unreachable", async () => {
    const surface = await getDeployedSurface(makeConfig("devnet"), {
      listActiveListings: async () => {
        throw new Error("network down");
      },
    });
    expect(surface.deployed).toBe(false);
    if (!surface.deployed) expect(surface.reason).toBe("unreachable");
  });

  it("live listings → deployed", async () => {
    const surface = await getDeployedSurface(makeConfig("localnet"), {
      listActiveListings: async () => listings,
    });
    expect(surface.deployed).toBe(true);
    if (surface.deployed) expect(surface.listingCount).toBe(2);
  });
});

describe("EmptyCatalog vs ZeroMatch selection (curation)", () => {
  it("no curation + supply → all carried (no empty state)", () => {
    const carried = applyCuration(listings, undefined);
    expect(carried).toHaveLength(2);
  });

  it("curation that matches NOTHING + supply → ZeroMatch (active curation, zero carried)", () => {
    const curation: Curation = { categories: ["nonexistent-category"], requireModeration: true };
    const carried = applyCuration(listings, curation);
    expect(carried).toHaveLength(0);
    // curationIsActive distinguishes ZeroMatch from EmptyCatalog in the section.
    expect(curationIsActive(curation)).toBe(true);
  });

  it("no active curation → EmptyCatalog path (not ZeroMatch) when supply is empty", () => {
    const curation: Curation = { requireModeration: true };
    expect(curationIsActive(curation)).toBe(false);
    expect(applyCuration([], curation)).toHaveLength(0);
  });

  it("single-category curation carries only that category", () => {
    const curation: Curation = { categories: ["design"], requireModeration: true };
    const carried = applyCuration(listings, curation);
    expect(carried.map((l) => l.address)).toEqual([A2]);
  });

  it("single-provider curation carries only that provider", () => {
    // `Curation.providers` is the branded `Address` output of the zod effect.
    const curation: Curation = {
      providers: [address(P1)],
      requireModeration: true,
    };
    const carried = applyCuration(listings, curation);
    expect(carried.map((l) => l.address)).toEqual([A1]);
  });
});
