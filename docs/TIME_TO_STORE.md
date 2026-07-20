# Time-to-Store — the <15-minute measurement protocol (stub)

_PLAN_2 C5. The measurement protocol below is defined here; the actual measured
run is a **[HUMAN]** step (recruit a fresh participant) and is **not** filled in
yet._

## The metric

**Time-to-store** = elapsed wall-clock time from a fresh participant opening a
template README to their **first sandbox hire confirmed** through a store they
deployed — keyed to **their own referrer wallet**.

Target: **< 15 minutes** on a clean machine.

> **Fee-bearing form is measurable.** Referral settlement is live on-chain, so
> the headline metric is the real thing: the deployer's first hire through
> their own store BEARS their referral fee (injected at the provider level and
> settled atomically). On localnet, the sandbox settles the same instruction
> surface as mainnet.

## Protocol

1. **Recruit** a participant who has **not** seen this repo. (This recruitment +
   the run itself is the [HUMAN] step.)
2. **Clean machine**: Node ≥ 22.23.1, no prior AgenC tooling, no cached configs.
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

The fee-bearing variant of this metric is UNBLOCKED (referral settlement is
live); it still must not be reported as measured until the [HUMAN] run happens.

## What "good" looks like

- The participant never opens a protocol source file (config-first held).
- The only required edit is the referrer wallet (and, per variant, one provider
  PDA / one category token).
- No manual RPC/indexer wiring on localnet (the sandbox bootstrap handles it).
