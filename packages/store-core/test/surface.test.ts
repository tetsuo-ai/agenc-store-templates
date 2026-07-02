/**
 * Surface-deployment check tests (PLAN_2 C2): a store renders an explicit
 * not-live page instead of an empty grid.
 */
import { describe, it, expect } from "vitest";
import {
  getDeployedSurface,
  SurfaceNotDeployedError,
} from "../src/config/surface.js";
import { defineStore } from "../src/config/index.js";
import { MINIMAL_CONFIG } from "./fixtures.js";

const probe = (listings: unknown[]) => ({
  listActiveListings: async () => listings,
});

const errorProbe = {
  listActiveListings: async () => {
    throw new Error("indexer down");
  },
};

describe("getDeployedSurface", () => {
  it("reports deployed when the probe returns listings", async () => {
    const config = defineStore(MINIMAL_CONFIG);
    const result = await getDeployedSurface(config, probe([1, 2, 3]));
    expect(result.deployed).toBe(true);
    if (result.deployed) expect(result.listingCount).toBe(3);
  });

  it("reports no-listings (not deployed) on an empty catalog", async () => {
    const config = defineStore(MINIMAL_CONFIG);
    const result = await getDeployedSurface(config, probe([]));
    expect(result.deployed).toBe(false);
    if (!result.deployed) {
      expect(result.reason).toBe("no-listings");
      expect(result.message).toMatch(/No listings/);
    }
  });

  it("reports unreachable when the probe throws", async () => {
    const config = defineStore(MINIMAL_CONFIG);
    const result = await getDeployedSurface(config, errorProbe);
    expect(result.deployed).toBe(false);
    if (!result.deployed) {
      expect(result.reason).toBe("unreachable");
      expect(result.message).toMatch(/unavailable/);
    }
  });

  it("reports mainnet-not-enabled WITHOUT a network call for un-overridden mainnet", async () => {
    // Build a mainnet config via the override so defineStore accepts it, then
    // simulate a deploy env that lost the override by clearing the flag.
    const config = defineStore({
      ...MINIMAL_CONFIG,
      network: "mainnet",
      allowMainnet: true,
    });
    const cleared = { ...config, allowMainnet: false };
    let probed = false;
    const result = await getDeployedSurface(cleared, {
      listActiveListings: async () => {
        probed = true;
        return [1];
      },
    });
    expect(probed).toBe(false); // the gate short-circuits before the probe
    expect(result.deployed).toBe(false);
    if (!result.deployed) {
      expect(result.reason).toBe("mainnet-not-enabled");
      // Mainnet IS live — the message must point at the missing opt-in, never
      // claim the network "launches later".
      expect(result.message).toMatch(/allowMainnet/);
      expect(result.message).not.toMatch(/Phase 9/);
    }
  });
});

describe("SurfaceNotDeployedError", () => {
  it("carries the reason + network and a default message", () => {
    const err = new SurfaceNotDeployedError("no-listings", "devnet");
    expect(err.reason).toBe("no-listings");
    expect(err.network).toBe("devnet");
    expect(err.message).toMatch(/devnet/);
    expect(err).toBeInstanceOf(Error);
  });
});
