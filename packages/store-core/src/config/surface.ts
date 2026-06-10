/**
 * Deployment-surface check (PLAN_2 C2 + the P6.5 `getDeployedSurface` path).
 *
 * A store must not render an empty grid when its target cluster simply has no
 * live listings (or, for `mainnet`, the surface is not deployed before Phase 9).
 * {@link getDeployedSurface} answers "is the catalog live on this cluster?" so a
 * template can render an explicit {@link SurfaceNotDeployedError}-driven page
 * ("listings are not live yet") instead of a silent empty state.
 *
 * This is intentionally transport-shaped (it takes a `read`-like listing source)
 * rather than reimplementing the P6.5 on-chain surface read, which is unbuilt.
 * When P6.5 ships, the resolver can additionally consult `surface_revision`
 * without changing this surface.
 *
 * @module config/surface
 */
import type { StoreConfig, StoreNetwork } from "./schema.js";

/**
 * The reason a store's catalog surface is not live. Drives the copy on the
 * not-deployed page.
 */
export type SurfaceNotDeployedReason =
  | "mainnet-not-launched"
  | "no-listings"
  | "unreachable";

/**
 * Thrown / returned when the catalog surface is not live on the target cluster.
 * Carries a machine-readable {@link SurfaceNotDeployedReason} and the network so
 * the template can render the correct explicit state.
 */
export class SurfaceNotDeployedError extends Error {
  /** Why the surface is not live. */
  readonly reason: SurfaceNotDeployedReason;
  /** The target cluster the check ran against. */
  readonly network: StoreNetwork;

  constructor(
    reason: SurfaceNotDeployedReason,
    network: StoreNetwork,
    message?: string,
  ) {
    super(message ?? SurfaceNotDeployedError.defaultMessage(reason, network));
    this.name = "SurfaceNotDeployedError";
    this.reason = reason;
    this.network = network;
  }

  /** A default human-readable message for a reason/network pair. */
  static defaultMessage(
    reason: SurfaceNotDeployedReason,
    network: StoreNetwork,
  ): string {
    switch (reason) {
      case "mainnet-not-launched":
        return "Mainnet listings are not live yet. This store is configured for mainnet, which launches in Phase 9.";
      case "no-listings":
        return `No listings are live on ${network} yet. Check back soon.`;
      case "unreachable":
        return `Could not reach the ${network} catalog. The indexer may be temporarily unavailable.`;
    }
  }
}

/**
 * The result of a surface check. `deployed: true` means the catalog has live
 * listings and a grid should render; `deployed: false` carries the reason so a
 * template can render the explicit not-live page.
 */
export type DeployedSurface =
  | { deployed: true; network: StoreNetwork; listingCount: number }
  | {
      deployed: false;
      network: StoreNetwork;
      reason: SurfaceNotDeployedReason;
      message: string;
    };

/**
 * A minimal listing-count probe. Any object exposing `listActiveListings()`
 * satisfies it — the `marketplace-react` `ReadTransport`, the SDK indexer
 * client wrapped to this shape, or a test stub.
 */
export interface SurfaceProbe {
  /** Resolve the active listings (only `.length` is used here). */
  listActiveListings(): Promise<{ length: number } | unknown[]>;
}

/**
 * Resolve whether the store's catalog surface is live on its target cluster.
 *
 * Order of checks:
 * 1. `mainnet` without `allowMainnet` → `mainnet-not-launched` WITHOUT a network
 *    call (the Phase 9 gate; a build-valid config can still reach here at boot
 *    if it set `allowMainnet`, in which case the probe runs normally).
 * 2. Probe the catalog. A probe error → `unreachable`. Zero listings →
 *    `no-listings`. Otherwise → deployed.
 *
 * @param config - The validated store config.
 * @param probe - A {@link SurfaceProbe} (typically the provider read transport).
 * @returns A {@link DeployedSurface}.
 */
export async function getDeployedSurface(
  config: StoreConfig,
  probe: SurfaceProbe,
): Promise<DeployedSurface> {
  const { network } = config;

  // The Phase 9 mainnet gate: a config that reached runtime on mainnet without
  // the explicit override is treated as not-launched (defense in depth — the
  // build already rejects this, but a hand-edited deploy env should still get
  // the explicit page, not an empty grid).
  if (network === "mainnet" && config.allowMainnet !== true) {
    return {
      deployed: false,
      network,
      reason: "mainnet-not-launched",
      message: SurfaceNotDeployedError.defaultMessage(
        "mainnet-not-launched",
        network,
      ),
    };
  }

  let count: number;
  try {
    const listings = await probe.listActiveListings();
    count = Array.isArray(listings)
      ? listings.length
      : (listings as { length: number }).length;
  } catch {
    return {
      deployed: false,
      network,
      reason: "unreachable",
      message: SurfaceNotDeployedError.defaultMessage("unreachable", network),
    };
  }

  if (count <= 0) {
    return {
      deployed: false,
      network,
      reason: "no-listings",
      message: SurfaceNotDeployedError.defaultMessage("no-listings", network),
    };
  }

  return { deployed: true, network, listingCount: count };
}
