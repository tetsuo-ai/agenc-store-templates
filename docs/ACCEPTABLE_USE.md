# Acceptable Use Policy — AgenC Store Templates

_Last updated: 2026-06-10_

This Acceptable Use Policy (AUP) governs stores deployed from the
**agenc-store-templates** and the **hosted AgenC indexer / storefront API** those
stores consume. It is a precondition for the template gallery submission
(PLAN_2 C5) and for issuing an indexer API key.

> **Why this exists.** A deployed store is a self-hosted fork: once cloned and
> deployed, Tetsuo AI cannot edit or delete it. But **every store consumes the
> hosted indexer via an API key**, and that key is the documented takedown lever
> (see [Enforcement](#enforcement)). This AUP defines what that key may be used
> for.

## 1. Scope

This policy applies to:

- anyone who deploys a store from these templates and consumes the hosted AgenC
  indexer / storefront API (the "operator");
- the catalog, listings, provider profiles, and hire flows the store surfaces.

It does **not** govern the on-chain AgenC protocol itself (escrow, settlement,
disputes), which is permissionless and enforced by the program.

## 2. What the API keys are for

The hosted indexer API key authorizes **read access** to the public on-chain
marketplace book (listings, hires, track records) and, where enabled, helper
endpoints (unsigned hire-transaction construction). It is rate-limited.

API keys are issued per operator and are **revocable** (see Enforcement).

## 3. Prohibited uses

You may not use a deployed store or the hosted API to:

1. **Facilitate illegal transactions** — surfacing or brokering hires for
   activity that is illegal in the operator's or buyer's jurisdiction
   (e.g. CSAM, terrorism financing, sanctioned-party dealings, sale of stolen
   data or credentials).
2. **Defraud buyers** — misrepresenting what a listing delivers, impersonating
   another provider or store, or hiding the fee disclosure (see §4).
3. **Evade moderation** — disabling the fail-closed moderation gate
   (`curation.requireModeration`) to surface listings an attestor flagged, where
   doing so would surface prohibited content. (The protocol-level neutrality
   policy for unattested listings is decided separately — PLAN.md P6.8 — and is
   not yet a configurable toggle.)
4. **Abuse the API** — exceeding rate limits via key-sharing or rotation,
   scraping for resale, or attempting to access another operator's data.
5. **Strip the referral disclosure** — removing the `/trust` fee disclosure or
   the checkout disclosure so a buyer cannot see who earns the referral fee
   (see §4).

## 4. Required disclosures

Every deployed store **must** keep the fee disclosure visible to buyers:

- the `/trust` page must name the protocol fee, any operator fee, and **this
  store's referral wallet + bps**;
- the checkout must surface the referral disclosure ("this site earns a referral
  fee").

> **Note.** Referral settlement is **live on-chain**: the configured referral
> fee is injected into every hire at the provider level and paid atomically at
> settlement. The disclosure requirements above are therefore about REAL money
> flow — a store must always show buyers who earns the fee. The templates
> enforce this; do not patch it out.

## 5. Reporting

Report abuse, a non-compliant store, or a security issue to:

- **abuse@agenc.tech** (or the abuse contact published on the docs site), with
  the store URL and the on-chain listing/task PDA where applicable.

Reports are triaged on a best-effort basis. Security-sensitive reports should be
marked as such.

## 6. Enforcement

The hosted indexer is the enforcement surface. On a confirmed violation, Tetsuo
AI may, at its discretion and without prior notice:

1. **Rate-limit or revoke the operator's API key** — the primary lever. A
   store with a revoked key can no longer read the hosted indexer; its catalog
   degrades to the designed "indexer unreachable" state. (A store self-hosting
   its own RPC gPA reads is not reachable this way; such stores are out of scope
   for hosted-API enforcement, and the on-chain protocol remains permissionless.)
2. **De-list the store** from the template gallery / showcase.
3. **Report** illegal activity to the relevant authorities where required by law.

Key revocation does not delete the deployed fork (we cannot) and does not affect
on-chain funds (escrow/dispute resolution is protocol-governed and recoverable —
see the [credible-exit guarantee](https://github.com/tetsuo-ai/agenc-protocol/blob/main/docs/CREDIBLE_EXIT.md)).

## 7. Changes

This policy may be updated. Material changes will be noted in the templates
repo changelog. Continued use of the hosted API after a change constitutes
acceptance.
