/**
 * Per-listing combined-fee pre-check tests (PLAN_2 C2). The checkout surfaces a
 * clear error BEFORE building a transaction that would revert on-chain.
 */
import { describe, it, expect } from "vitest";
import { checkCombinedFee } from "../src/config/referrer-fee.js";
import { REFERRER_COMBINED_FEE_BPS_CAP } from "../src/config/schema.js";

describe("checkCombinedFee", () => {
  it("passes when protocol + operator + referrer is within the cap", () => {
    const result = checkCombinedFee({
      protocolFeeBps: 250,
      operatorFeeBps: 1000,
      referrerFeeBps: 250,
    });
    expect(result.totalBps).toBe(1500);
    expect(result.withinCap).toBe(true);
    expect(result.overBps).toBe(0);
    expect(result.error).toBeNull();
  });

  it("passes exactly AT the cap", () => {
    const result = checkCombinedFee({
      protocolFeeBps: 1000,
      operatorFeeBps: 2000,
      referrerFeeBps: 1000,
    });
    expect(result.totalBps).toBe(REFERRER_COMBINED_FEE_BPS_CAP);
    expect(result.withinCap).toBe(true);
  });

  it("fails over the cap with an actionable error naming the overage", () => {
    const result = checkCombinedFee({
      protocolFeeBps: 1000,
      operatorFeeBps: 2500,
      referrerFeeBps: 1000,
    });
    expect(result.totalBps).toBe(4500);
    expect(result.withinCap).toBe(false);
    expect(result.overBps).toBe(500);
    expect(result.error).toMatch(/4500 bps/);
    expect(result.error).toMatch(/500 bps/);
    expect(result.error).toMatch(/referrer fee/);
  });

  it("respects a custom cap argument", () => {
    const result = checkCombinedFee(
      { protocolFeeBps: 100, operatorFeeBps: 100, referrerFeeBps: 100 },
      250,
    );
    expect(result.withinCap).toBe(false);
    expect(result.overBps).toBe(50);
  });
});
