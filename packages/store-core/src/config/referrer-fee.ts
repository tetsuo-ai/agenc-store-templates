/**
 * Per-listing combined referral-fee pre-computation (PLAN_2 C2).
 *
 * The deployed on-chain settlement path enforces a combined cap:
 * `protocol + operator + referrer ≤ 4000 bps`. A store config validates the
 * referrer share ALONE at build time, but the protocol fee and a listing's
 * operator fee are only known at checkout. This module pre-computes the combined
 * split per listing so the checkout can surface a CLEAR error BEFORE building a
 * transaction that would revert on-chain — never a silent drop, never a failed
 * broadcast.
 *
 * This is pure arithmetic on disclosed fee rates; it does NOT inject a referrer
 * into a hire — injection happens at the provider level in `marketplace-react`
 * (`resolveReferrerCapability()` reports `live: true` whenever a validated
 * referrer is configured; referral settlement has been live on-chain since
 * 2026-06-11).
 *
 * @module config/referrer-fee
 */
import { REFERRER_COMBINED_FEE_BPS_CAP } from "./schema.js";

/** The fee rates (in bps) that share the combined on-chain cap. */
export interface CombinedFeeInput {
  /** The live protocol fee, in basis points. */
  protocolFeeBps: number;
  /** The listing's operator fee, in basis points (0 when no operator). */
  operatorFeeBps: number;
  /** The store's configured referrer fee, in basis points. */
  referrerFeeBps: number;
}

/** The result of a combined-cap check for one listing. */
export interface CombinedFeeResult {
  /** Sum of protocol + operator + referrer, in basis points. */
  totalBps: number;
  /** The combined cap that applies ({@link REFERRER_COMBINED_FEE_BPS_CAP}). */
  capBps: number;
  /** Whether the combined split is within the cap (safe to build a hire). */
  withinCap: boolean;
  /**
   * Basis points by which the split exceeds the cap (0 when within cap). The
   * referrer share the owner would have to reduce to fit.
   */
  overBps: number;
  /**
   * A human-readable error to surface in the checkout when `withinCap` is
   * false, or `null` when the split is safe.
   */
  error: string | null;
}

/**
 * Pre-compute the combined `protocol + operator + referrer` split for one
 * listing and check it against the cap.
 *
 * @param input - The three fee rates ({@link CombinedFeeInput}).
 * @param capBps - The combined cap (defaults to the protocol cap of 4000 bps).
 * @returns A {@link CombinedFeeResult}. When `withinCap` is false, `error`
 *   explains exactly which listing's split is too high and by how much.
 */
export function checkCombinedFee(
  input: CombinedFeeInput,
  capBps: number = REFERRER_COMBINED_FEE_BPS_CAP,
): CombinedFeeResult {
  const { protocolFeeBps, operatorFeeBps, referrerFeeBps } = input;
  const totalBps = protocolFeeBps + operatorFeeBps + referrerFeeBps;
  const withinCap = totalBps <= capBps;
  const overBps = withinCap ? 0 : totalBps - capBps;
  const error = withinCap
    ? null
    : `This listing's combined fee split is ${totalBps} bps, over the ${capBps} bps ` +
      `cap (protocol ${protocolFeeBps} + operator ${operatorFeeBps} + referrer ` +
      `${referrerFeeBps}). Reduce the store's referrer fee by at least ${overBps} bps ` +
      "for this listing to be hireable.";
  return { totalBps, capBps, withinCap, overBps, error };
}
