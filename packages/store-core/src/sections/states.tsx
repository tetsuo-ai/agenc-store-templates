/**
 * The specced empty / error states (PLAN_2 C3). Each store surface has a
 * DESIGNED state, not an improvised one:
 *
 * - {@link SurfaceNotDeployedSection} — the C2 surface-check page (a mainnet
 *   config missing its `allowMainnet` opt-in, no listings, or
 *   indexer-unreachable).
 * - {@link EmptyCatalogSection} — "no listings" on devnet/localnet, with the
 *   seeded-fixture hint.
 * - {@link ZeroMatchSection} — curation filters matched nothing.
 * - {@link IndexerUnreachableSection} — cached/static fallback + retry.
 *
 * Presentational; built on `marketplace-react`'s `StateMessage` so the
 * loading/empty/error announcement is consistent + accessible.
 *
 * @module sections/states
 */
import type { ReactElement } from "react";
import { StateMessage } from "@tetsuo-ai/marketplace-react";
import type { DeployedSurface } from "../config/surface.js";
import type { StoreNetwork } from "../config/schema.js";

/** Shared themable props. */
interface StateSectionBase {
  /** Emit no theme classes (white-label). */
  unstyled?: boolean;
}

/**
 * Render the explicit not-deployed surface page from a {@link DeployedSurface}
 * (the `deployed: false` branch). This is what a store shows instead of an
 * empty grid when its cluster has no live catalog.
 */
export function SurfaceNotDeployedSection({
  surface,
  unstyled,
}: StateSectionBase & {
  surface: Extract<DeployedSurface, { deployed: false }>;
}): ReactElement {
  return (
    <StateMessage
      kind="empty"
      message={surface.message}
      unstyled={unstyled}
      role="status"
    />
  );
}

/**
 * The empty-catalog state for devnet/localnet — "no listings", with a hint to
 * run the seed script in local development.
 */
export function EmptyCatalogSection({
  network,
  unstyled,
}: StateSectionBase & { network: StoreNetwork }): ReactElement {
  const hint =
    network === "localnet"
      ? "No listings are live. Run `npm run sandbox:up` to boot the local validator and seed listings."
      : network === "devnet"
        ? "No listings are live on devnet yet."
        : "No listings are live yet.";
  return <StateMessage kind="empty" message={hint} unstyled={unstyled} />;
}

/**
 * The zero-match state: there ARE listings, but the store's curation filters
 * matched none. Distinct copy from the empty catalog so the owner knows it is
 * the filters, not the supply.
 */
export function ZeroMatchSection({
  unstyled,
  onClearFilters,
}: StateSectionBase & { onClearFilters?: () => void }): ReactElement {
  return (
    <StateMessage
      kind="empty"
      message="No listings match this store's curation filters."
      onRetry={onClearFilters}
      unstyled={unstyled}
    />
  );
}

/**
 * The indexer-unreachable state: the read transport could not be reached. Shows
 * a retry; a template may render cached/static listings above this.
 */
export function IndexerUnreachableSection({
  unstyled,
  onRetry,
}: StateSectionBase & { onRetry?: () => void }): ReactElement {
  return (
    <StateMessage
      kind="error"
      message="Could not reach the catalog. The indexer may be temporarily unavailable."
      onRetry={onRetry}
      unstyled={unstyled}
    />
  );
}
