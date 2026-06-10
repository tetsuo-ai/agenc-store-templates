# Time-to-Store — the <15-minute measurement protocol (stub)

_PLAN_2 C5. The measurement protocol below is defined here; the actual measured
run is a **[HUMAN]** step (recruit a fresh participant) and is **not** filled in
yet._

## The metric

**Time-to-store** = elapsed wall-clock time from a fresh participant opening a
template README to their **first sandbox hire confirmed** through a store they
deployed — keyed to **their own referrer wallet**.

Target: **< 15 minutes** on a clean machine.

> **Gated on P6.2.** PLAN_2 §0: the headline "first *referral-fee-bearing* hire"
> form of this metric is **blocked on P6.2** (referral settlement is not live, so
> no hire bears a referral fee yet). Until P6.2 ships, measure the proxy:
> **first sandbox hire confirmed through the deployer's own store** (the referral
> wallet is configured + disclosed, just not yet charged). Record the proxy
> result and mark the fee-bearing form as P6.2-blocked.

## Protocol

1. **Recruit** a participant who has **not** seen this repo. (This recruitment +
   the run itself is the [HUMAN] step.)
2. **Clean machine**: Node ≥ 20.18, no prior AgenC tooling, no cached configs.
3. **Clock start**: the participant opens a template README (or runs
   `npx create-agenc-store`).
4. The participant follows ONLY the README + CLI prompts:
   - scaffold (`npx create-agenc-store my-store` — or one-click deploy for a
     hosted-indexer store);
   - configure their referrer wallet (CLI prompt or `agenc.config.ts`);
   - boot the local sandbox (`npm run sandbox:up`) or point at a devnet store;
   - `npm run dev`;
   - open the store, connect a (sandbox-funded) wallet, hire a listing.
5. **Clock stop**: the hire transaction confirms and appears on `/dashboard`.
6. **Record**: screen-record the full run; capture the elapsed time, the friction
   points, and the participant's verbatim confusion.

## Result

| Date | Participant (anon) | Variant | Network | Result | Notes |
|------|--------------------|---------|---------|--------|-------|
| _TBD_ | _TBD_ | _TBD_ | localnet/devnet | _not measured_ | [HUMAN] run pending |

The fee-bearing variant of this metric stays **BLOCKED-ON-P6.2** and must not be
reported as measured until referral settlement is live on the target cluster.

## What "good" looks like

- The participant never opens a protocol source file (config-first held).
- The only required edit is the referrer wallet (and, per variant, one provider
  PDA / one category token).
- No manual RPC/indexer wiring on localnet (the sandbox bootstrap handles it).
