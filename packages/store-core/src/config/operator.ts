/**
 * Operator terms on listing creation (WP-B1).
 *
 * The SDK's `createServiceListing` already accepts `operator` and
 * `operatorFeeBps` — the on-chain listing stamps them onto every task hired
 * from it, and settlement pays the operator leg of the
 * `protocol + operator + referrer` split atomically. This module is the config
 * plumbing: it turns the validated `StoreConfig.operator` block into the exact
 * argument pair `createServiceListing` consumes, so a store operator that
 * creates listings on behalf of providers earns its cut with no hand-wired
 * accounts.
 *
 * @module config/operator
 */
import type { StoreConfig } from "./schema.js";

/**
 * The operator argument pair for the SDK's `createServiceListing`.
 * `operator: null` + `operatorFeeBps: 0` is the exact no-operator encoding the
 * program treats as "no operator leg".
 */
export interface ListingOperatorTerms {
  /** The operator wallet (base58), or `null` for no operator leg. */
  operator: string | null;
  /** Operator fee in basis points (0 when no operator). */
  operatorFeeBps: number;
}

/**
 * Resolve the `createServiceListing` operator terms from a validated store
 * config.
 *
 * @param config - The validated store config (or just its `operator` slice).
 * @returns The `{ operator, operatorFeeBps }` pair to spread into
 *   `createServiceListing`. When no operator block is configured this is the
 *   documented no-leg encoding (`{ operator: null, operatorFeeBps: 0 }`) — the
 *   program never routes funds to a defaulted address.
 */
export function listingOperatorTerms(
  config: Pick<StoreConfig, "operator">,
): ListingOperatorTerms {
  if (!config.operator) {
    return { operator: null, operatorFeeBps: 0 };
  }
  return {
    operator: config.operator.wallet,
    operatorFeeBps: config.operator.feeBps,
  };
}
