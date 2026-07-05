/**
 * LISTING-moderation trust + hire-time acquisition (§12 roster-trust
 * consumption rail).
 *
 * P1.2 hire gates (`hire_from_listing[_humanless]`) consume an EXPLICIT
 * moderator's `ListingModeration` record. Until this module, store-core never
 * checked WHOSE record actually exists for a listing — it named the store's
 * own attestor and hoped, so a listing attested by another marketplace's
 * bonded roster attestor (cross-node supply) could never be hired from a
 * template store. Two rails fix that:
 *
 * 1. TRUST POLICY (`moderation.trustPolicy`, default `edge-list` — today's
 *    behavior): under `any-bonded-attestor` the on-chain roster is the trust
 *    root — a CONSUMABLE record by ANY registered, non-exiting
 *    `ModerationAttestor` is trusted (bond/exit verified on-chain at read
 *    time, short-TTL cache).
 * 2. ACQUISITION: when no CONSUMABLE trusted record exists, the store POSTs
 *    the listing's hosted spec to its OWN attestation service
 *    (`<attestor origin>/v1/moderation/listings` — the sdk's
 *    `requestListingModeration` is the client) to acquire a record it does
 *    trust, then re-discovers. BLOCKED verdicts fail closed.
 *
 * The resolver mirrors the program's hire-gate pipeline in order:
 *
 * 1. read the listing (spec hash + spec pointer + catalog fields);
 * 2. the §5.2 BLOCK floor — `["moderation_block", spec_hash]` is checked
 *    UNCONDITIONALLY and is never relaxed ({@link isSpecHashBlocked}); a
 *    blocked hash never discovers and NEVER acquires;
 * 3. the store's own catalog/curation gate — this route is public, and
 *    acquisition is a PAID side effect, so it only runs for listings this
 *    store actually carries;
 * 4. `ModerationConfig` — when moderation is DISABLED or the P1.3 liveness
 *    deadman has RELAXED the gate ({@link moderationLivenessRelaxed}), no
 *    attestation is required on-chain, so the resolver returns the store's
 *    listing-agnostic moderator with NO acquisition;
 * 5. own-set discovery first (store moderators + the global moderation
 *    authority — roster-independent), THEN the roster pass under
 *    `any-bonded-attestor`, THEN acquisition on a definitive miss. Every
 *    discovered hit is additionally checked to be UNLOCKABLE at the gate
 *    (authored by the global authority, or by a registered non-exiting
 *    roster attestor).
 *
 * "Consumable" means the record would actually pass the program's
 * `validate_listing_moderation_for_hire` record checks (status CLEAN or
 * HUMAN_APPROVED, risk score in bounds, unexpired) — a record that merely
 * EXISTS is never named ({@link isConsumableListingModeration}). The
 * program's consumption gates stay the enforcement point — this module only
 * decides which records THIS store is willing to name, before any money
 * moves.
 *
 * Failure discipline (every path is fail-closed):
 * - transient RPC/read errors PROPAGATE (they never masquerade as "no
 *   record", so they can never trigger an unnecessary paid acquisition);
 * - a BLOCKED hash/verdict throws {@link ListingModerationBlockedError};
 * - a roster over the {@link MAX_ROSTER_ATTESTORS} bound degrades to the
 *   own-moderator set with acquisition DISABLED (never a network-wide
 *   outage, never a paid side effect off a silently-shrunken trust set);
 * - concurrent resolutions for one listing coalesce (single-flight) and
 *   failures are negative-cached briefly, so the paid acquisition path
 *   cannot be cost-amplified by request fan-out;
 * - anything unresolvable throws a plain, honest Error — the client never
 *   names a guessed moderator and never signs.
 *
 * Server-only companion of `activation/server.ts` (RPC reads + remote POST).
 *
 * @module activation/listing-trust
 */
import { address, createSolanaRpc, getBase58Decoder } from "@solana/kit";
import {
  AGENC_COORDINATION_PROGRAM_ADDRESS,
  facade,
  fetchAllMaybeListingModeration,
  fetchMaybeListingModeration,
  fetchMaybeModerationAttestor,
  fetchMaybeModerationBlock,
  fetchMaybeModerationConfig,
  fetchMaybeServiceListing,
  findListingModerationPda,
  findModerationAttestorPda,
  findModerationBlockPda,
  findModerationConfigPda,
  getModerationAttestorDecoder,
  ListingModerationError,
  MODERATION_ATTESTOR_DISCRIMINATOR,
  requestListingModeration,
  values,
} from "@tetsuo-ai/marketplace-sdk";
import { applyCuration, type CurateableListing } from "../config/curation.js";
import type { Curation } from "../config/schema.js";

/** Which trust root the store consumes LISTING moderation records from. */
export type ListingTrustPolicy = "edge-list" | "any-bonded-attestor";

/**
 * Resolve the effective trust policy: the explicit
 * `moderation.trustPolicy` config wins; the `AGENC_MODERATION_TRUST` deploy
 * env is honored as a fallback (exact value only); everything else is
 * `edge-list`, so nothing changes until the operator opts in.
 */
export function resolveListingTrustPolicy(
  configPolicy: ListingTrustPolicy | undefined,
  env: { AGENC_MODERATION_TRUST?: string | undefined } = typeof process !==
  "undefined"
    ? (process.env as { AGENC_MODERATION_TRUST?: string })
    : {},
): ListingTrustPolicy {
  if (configPolicy === "any-bonded-attestor" || configPolicy === "edge-list") {
    return configPolicy;
  }
  return env.AGENC_MODERATION_TRUST?.trim() === "any-bonded-attestor"
    ? "any-bonded-attestor"
    : "edge-list";
}

// ------------------------------------------------------------- roster scan

/** One decoded roster entry (the slice trust decisions need). */
export interface RosterAttestorEntry {
  /** The attestor wallet (the `moderator` its records are keyed by). */
  attestor: string;
  /** True when `exit_at != 0` — gate-rejected from exit REQUEST time. */
  exiting: boolean;
}

/** Roster snapshot the policy layer consumes. */
export interface RosterSnapshot {
  /** Registered, non-exiting attestors (consumable at the gates). */
  active: string[];
  /** Attestors with a running exit clock — NOT consumable. */
  exiting: Set<string>;
}

/** The RPC slice a roster scan needs (any `createSolanaRpc` satisfies it). */
export interface RosterScanRpc {
  getProgramAccounts(
    program: string,
    config: unknown,
  ): { send: () => Promise<unknown> };
}

/** The account-read slice discovery needs (single + batched reads). */
export type ListingReadRpc = Parameters<typeof fetchMaybeServiceListing>[0] &
  Parameters<typeof fetchAllMaybeListingModeration>[0];

type RawProgramAccounts = {
  value: Array<{ pubkey: string; account: { data: [string, string] } }>;
};

/**
 * Hard cap on the roster snapshot this rail will consume (bounded, never
 * silently truncated). Roster registration is BONDED on-chain
 * (`REGISTRATION_BOND_LAMPORTS` per entry), so real rosters stay small; a
 * scan that returns more entries than this is either an indexing bug or an
 * economically-anomalous roster (e.g. a sybil registration wave).
 *
 * Over the cap the scan raises {@link RosterCapExceededError} — a TYPED
 * signal so the resolver can degrade to the own-moderator candidate set
 * (with acquisition disabled — a shrunken trust set must never trigger the
 * paid side effect) instead of 502ing every hire on the network. Entries are
 * never silently dropped. Also bounds per-hire discovery work: candidate
 * records are probed in {@link DISCOVERY_BATCH_SIZE}-address
 * `getMultipleAccounts` batches.
 */
export const MAX_ROSTER_ATTESTORS = 512;

/** `getMultipleAccounts` batch bound for candidate-record probes. */
const DISCOVERY_BATCH_SIZE = 100;

/**
 * Raised by {@link fetchRosterAttestors} when the on-chain roster exceeds
 * {@link MAX_ROSTER_ATTESTORS}. The resolver catches EXACTLY this type to
 * degrade gracefully; every other roster error propagates (transient RPC
 * failures must never shrink the trust set).
 */
export class RosterCapExceededError extends Error {
  constructor(count: number) {
    super(
      `Moderation-attestor roster scan returned ${count} entries, over the MAX_ROSTER_ATTESTORS bound (${MAX_ROSTER_ATTESTORS}). Refusing to make trust decisions on a truncated roster.`,
    );
    this.name = "RosterCapExceededError";
  }
}

/**
 * Scan the on-chain moderation-attestor roster (gPA by discriminator) and
 * decode each entry's exit state (uncached — see
 * {@link bondedRosterModerators}).
 *
 * Strict by design:
 * - more than {@link MAX_ROSTER_ATTESTORS} entries →
 *   {@link RosterCapExceededError} (no silent truncation);
 * - an entry that matches the discriminator but fails to decode → throws
 *   (layout drift means this client can no longer be trusted to read exit
 *   state; silently skipping would shrink the trusted set, and a shrunken
 *   set can trigger unnecessary paid acquisitions).
 */
export async function fetchRosterAttestors(
  rpc: RosterScanRpc,
): Promise<RosterAttestorEntry[]> {
  const bytes58 = getBase58Decoder().decode(
    Uint8Array.from(Array.from(MODERATION_ATTESTOR_DISCRIMINATOR)),
  );
  const raw = (await rpc
    .getProgramAccounts(AGENC_COORDINATION_PROGRAM_ADDRESS as string, {
      commitment: "confirmed",
      encoding: "base64",
      withContext: true,
      filters: [{ memcmp: { offset: 0n, bytes: bytes58, encoding: "base58" } }],
    })
    .send()) as RawProgramAccounts;
  if (raw.value.length > MAX_ROSTER_ATTESTORS) {
    throw new RosterCapExceededError(raw.value.length);
  }
  const decoder = getModerationAttestorDecoder();
  const entries: RosterAttestorEntry[] = [];
  for (const account of raw.value) {
    let data: ReturnType<typeof decoder.decode>;
    try {
      data = decoder.decode(
        Uint8Array.from(Buffer.from(account.account.data[0], "base64")),
      );
    } catch (cause) {
      throw new Error(
        `ModerationAttestor account ${account.pubkey} matched the roster discriminator but failed to decode — the on-chain layout is newer than this client. Upgrade @tetsuo-ai/marketplace-sdk / @tetsuo-ai/store-core.`,
        { cause },
      );
    }
    entries.push({
      attestor: data.attestor as string,
      exiting: data.exitAt !== 0n,
    });
  }
  return entries;
}

const ROSTER_CACHE_TTL_MS = 60_000;
// Keyed by the rpc object so independent resolvers/clusters can never
// cross-talk (the resolver holds ONE rpc for its lifetime, so its snapshot
// caches effectively across requests).
let rosterCaches = new WeakMap<
  object,
  { at: number; snapshot: RosterSnapshot }
>();

const MODERATION_CONFIG_CACHE_TTL_MS = 60_000;
let moderationConfigCaches = new WeakMap<
  object,
  { at: number; snapshot: ModerationConfigSnapshot }
>();

/** Test seam: drop all roster + moderation-config caches. */
export function __clearListingTrustCachesForTests(): void {
  rosterCaches = new WeakMap();
  moderationConfigCaches = new WeakMap();
}

/** Cached roster snapshot (60s TTL — exit state stays read-time-fresh). */
export async function bondedRosterModerators(
  rpc: RosterScanRpc,
): Promise<RosterSnapshot> {
  const now = Date.now();
  const cached = rosterCaches.get(rpc);
  if (cached && now - cached.at < ROSTER_CACHE_TTL_MS) {
    return cached.snapshot;
  }
  const entries = await fetchRosterAttestors(rpc);
  const snapshot: RosterSnapshot = {
    active: entries.filter((e) => !e.exiting).map((e) => e.attestor),
    exiting: new Set(entries.filter((e) => e.exiting).map((e) => e.attestor)),
  };
  rosterCaches.set(rpc, { at: now, snapshot });
  return snapshot;
}

/**
 * The policy-aware trusted-moderator candidate list, in lookup order (the
 * store's own attestor(s) first — the common case).
 *
 * - `edge-list`: exactly `storeModerators` (today's behavior — the store's
 *   own attestor / `moderation.moderator` override; NO roster read happens,
 *   so keeping the default keeps today's exact RPC footprint).
 * - `any-bonded-attestor`: `storeModerators` (minus known-exiting) plus every
 *   registered, non-exiting roster attestor.
 */
export async function trustedListingModerators(params: {
  rpc: RosterScanRpc;
  storeModerators: readonly string[];
  trustPolicy: ListingTrustPolicy;
  /** Injectable roster snapshot (tests / precomputed). */
  roster?: RosterSnapshot;
}): Promise<string[]> {
  const own = [...new Set(params.storeModerators.filter(Boolean))];
  if (params.trustPolicy !== "any-bonded-attestor") return own;
  const snapshot = params.roster ?? (await bondedRosterModerators(params.rpc));
  const ordered = new Set<string>();
  for (const entry of own) {
    // A known-exiting attestor's record would revert at the gate (the window
    // closes at exit REQUEST) — drop it before a wallet ever signs.
    if (snapshot.exiting.has(entry)) continue;
    ordered.add(entry);
  }
  for (const attestor of snapshot.active) ordered.add(attestor);
  return [...ordered];
}

// ------------------------------------------ moderation config + liveness

/**
 * Default P1.3 moderation liveness window (mirror of the program's
 * `DEFAULT_MODERATION_LIVENESS_WINDOW_SECS`): 90 days of authority silence
 * relaxes the consumption gates to moderation-optional.
 */
export const DEFAULT_MODERATION_LIVENESS_WINDOW_SECS = 7_776_000;

/**
 * Mirror of the program's `moderation_liveness_relaxed` (batch-2 A2,
 * `moderation_gate_helpers.rs`): `true` when the moderation authority has
 * been silent — no `configure_task_moderation` / heartbeat bump of
 * `updated_at` — for longer than the liveness window. `window_secs == 0`
 * reads as the 90-day default; `updated_at <= 0` stays STRICT (the deadman
 * only fires on evidence of a once-live, now-silent authority). The BLOCK
 * floor is deliberately NOT consulted here and is never relaxed.
 */
export function moderationLivenessRelaxed(
  updatedAt: bigint,
  windowSecs: number,
  nowSeconds: number,
): boolean {
  if (updatedAt <= 0n) return false;
  const effectiveWindow =
    windowSecs > 0 ? windowSecs : DEFAULT_MODERATION_LIVENESS_WINDOW_SECS;
  return BigInt(nowSeconds) > updatedAt + BigInt(effectiveWindow);
}

/** The `ModerationConfig` slice the trust rail consumes. */
export interface ModerationConfigSnapshot {
  /** False when the config account does not exist (hires revert anyway). */
  exists: boolean;
  /**
   * The global moderation authority — records it authored unlock the gates
   * WITHOUT a roster entry (the program's first acceptance branch), and ALL
   * pre-P1.2 legacy-seed records were authority-authored. `null` when unset
   * (`Pubkey::default()`) or the config is missing.
   */
  moderationAuthority: string | null;
  /** The on-chain `enabled` flag — false = no attestation required. */
  enabled: boolean;
  /** Authority heartbeat (`updated_at`) — the P1.3 deadman signal. */
  updatedAt: bigint;
  /** Liveness window carved from `_reserved[0..4]` LE u32 (0 = default). */
  livenessWindowSecs: number;
}

/** `Pubkey::default()` in base58 (an unset moderation authority). */
const DEFAULT_PUBKEY = "11111111111111111111111111111111";

/**
 * Read the on-chain `ModerationConfig` into a {@link ModerationConfigSnapshot}
 * (cached per rpc, 60s TTL — same freshness class as the roster). RPC errors
 * propagate; a MISSING account is a definitive `exists: false` snapshot.
 */
export async function moderationConfigSnapshot(
  rpc: ListingReadRpc,
): Promise<ModerationConfigSnapshot> {
  const now = Date.now();
  const cached = moderationConfigCaches.get(rpc);
  if (cached && now - cached.at < MODERATION_CONFIG_CACHE_TTL_MS) {
    return cached.snapshot;
  }
  const [pda] = await findModerationConfigPda();
  const maybe = await fetchMaybeModerationConfig(rpc, pda);
  let snapshot: ModerationConfigSnapshot;
  if (!maybe.exists) {
    snapshot = {
      exists: false,
      moderationAuthority: null,
      enabled: true,
      updatedAt: 0n,
      livenessWindowSecs: 0,
    };
  } else {
    const reserved = maybe.data.reserved;
    const windowSecs =
      (reserved[0] ?? 0) +
      (reserved[1] ?? 0) * 0x100 +
      (reserved[2] ?? 0) * 0x10000 +
      (reserved[3] ?? 0) * 0x1000000;
    const authority = String(maybe.data.moderationAuthority);
    snapshot = {
      exists: true,
      moderationAuthority: authority === DEFAULT_PUBKEY ? null : authority,
      enabled: maybe.data.enabled,
      updatedAt: maybe.data.updatedAt,
      livenessWindowSecs: windowSecs,
    };
  }
  moderationConfigCaches.set(rpc, { at: now, snapshot });
  return snapshot;
}

// ------------------------------------------------------------- BLOCK floor

/** Mirror of the program's `moderation_block_status` constants. */
export const MODERATION_BLOCK_STATUS = {
  CLEARED: 0,
  BLOCKED: 1,
} as const;

/**
 * The §5.2 BLOCK floor, mirrored client-side: `true` when the multisig
 * takedown PDA `["moderation_block", spec_hash]` exists with status BLOCKED.
 * The program checks this UNCONDITIONALLY (`require_content_not_blocked` —
 * not gated on `enabled`, never relaxed by the liveness deadman), so the
 * resolver must never name a moderator — and NEVER pay for an acquisition —
 * for a blocked hash. A CLEARED account (the audit trail stays open) reads
 * as unblocked, exactly like `ModerationBlock::is_blocked`.
 */
export async function isSpecHashBlocked(
  rpc: ListingReadRpc,
  specHashHex: string,
): Promise<boolean> {
  const [pda] = await findModerationBlockPda({
    contentHash: hexToBytes32(specHashHex),
  });
  const maybe = await fetchMaybeModerationBlock(rpc, pda);
  return maybe.exists && maybe.data.status === MODERATION_BLOCK_STATUS.BLOCKED;
}

// -------------------------------------------------------- record discovery

/**
 * Moderation status constants (mirror of the program's
 * `task_moderation_status` module — plain u8s by design).
 */
export const LISTING_MODERATION_STATUS = {
  CLEAN: 0,
  SUSPICIOUS: 1,
  BLOCKED: 2,
  SCANNER_UNAVAILABLE: 3,
  HUMAN_APPROVED: 4,
  HUMAN_REJECTED: 5,
} as const;

/**
 * Mirror of the program's `TASK_MODERATION_RISK_SCORE_MAX`: the hire gate
 * rejects records with a risk score above this.
 */
export const MAX_CONSUMABLE_RISK_SCORE = 100;

/**
 * Client-side safety margin against the cluster clock: a record whose
 * `expires_at` lands within this window is treated as already expired, so we
 * never name a record that will have expired by the time the human signs the
 * hire. Strictness in this direction only ever fails CLOSED (worst case: one
 * re-attestation of a record that was seconds from expiry anyway).
 */
export const EXPIRY_SAFETY_WINDOW_SECS = 30;

/**
 * Would this `ListingModeration` record actually pass the program's
 * `validate_listing_moderation_for_hire` record-level checks? A record that
 * merely EXISTS must never short-circuit acquisition — consuming an expired
 * or non-publishable record would just revert on-chain after the buyer
 * signed.
 *
 * Mirrors the on-chain gate exactly, plus {@link EXPIRY_SAFETY_WINDOW_SECS}:
 * - `status` is CLEAN or HUMAN_APPROVED
 *   (`is_publishable_task_moderation_status`);
 * - `risk_score <= TASK_MODERATION_RISK_SCORE_MAX`;
 * - `expires_at == 0 || expires_at >= now` (with the safety window).
 *
 * The listing/spec-hash binding is enforced structurally by the PDA seeds
 * the record was fetched at; the moderator-authorization leg is the
 * candidate list plus the resolver's unlockability check.
 */
export function isConsumableListingModeration(
  record: { status: number; riskScore: number; expiresAt: bigint },
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (
    record.status !== LISTING_MODERATION_STATUS.CLEAN &&
    record.status !== LISTING_MODERATION_STATUS.HUMAN_APPROVED
  ) {
    return false;
  }
  if (record.riskScore > MAX_CONSUMABLE_RISK_SCORE) return false;
  if (
    record.expiresAt !== 0n &&
    record.expiresAt < BigInt(nowSeconds + EXPIRY_SAFETY_WINDOW_SECS)
  ) {
    return false;
  }
  return true;
}

/** A discovered, CONSUMABLE listing-moderation record by a trusted moderator. */
export interface DiscoveredListingRecord {
  /** Who authored the record — the hire gate's `moderator` argument. */
  moderator: string;
  /** Where the record lives (v2 moderator-keyed, or the frozen legacy PDA). */
  recordPda: string;
  /** True when the record sits at the pre-P1.2 legacy seeds. */
  legacy: boolean;
  /** CLEAN(0) / HUMAN_APPROVED(4) — anything else is never returned. */
  status: number;
  /** Normalized 0-100 risk score. */
  riskScore: number;
  /** Record expiry (0n = never). */
  expiresAt: bigint;
}

const HASH_HEX_64 = /^[0-9a-f]{64}$/i;

function hexToBytes32(hex: string): Uint8Array {
  if (!HASH_HEX_64.test(hex)) {
    throw new Error("specHashHex must be 64 hex chars (32 bytes).");
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHexLower(bytes: ArrayLike<number>): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] as number).toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Find the first trusted moderator's CONSUMABLE `ListingModeration` record
 * for (listing, specHash) — v2 moderator-keyed seeds per candidate (probed
 * in {@link DISCOVERY_BATCH_SIZE}-address `getMultipleAccounts` batches, in
 * candidate order), then the frozen legacy seeds (accepted only when the
 * stored moderator is a candidate).
 *
 * Records that exist but would revert at the hire gate
 * ({@link isConsumableListingModeration}) are SKIPPED — a later candidate's
 * valid record still wins, and a full miss falls through to acquisition.
 * Returns `null` only on a DEFINITIVE miss; RPC errors propagate.
 */
export async function discoverListingModerationRecord(
  rpc: ListingReadRpc,
  params: {
    listing: string;
    specHashHex: string;
    candidates: readonly string[];
    /** Clock override (tests). Seconds since epoch. */
    nowSeconds?: number;
    /** Skip the legacy-seed probe (the acquisition re-discovery pass). */
    skipLegacy?: boolean;
  },
): Promise<DiscoveredListingRecord | null> {
  const listing = address(params.listing);
  const specHash = hexToBytes32(params.specHashHex);
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);

  const pdas = await Promise.all(
    params.candidates.map(async (moderator) => {
      const [pda] = await findListingModerationPda({
        listing,
        jobSpecHash: specHash,
        moderator: address(moderator),
      });
      return pda;
    }),
  );
  for (let start = 0; start < pdas.length; start += DISCOVERY_BATCH_SIZE) {
    const chunk = pdas.slice(start, start + DISCOVERY_BATCH_SIZE);
    const accounts = await fetchAllMaybeListingModeration(rpc, chunk);
    for (let i = 0; i < accounts.length; i++) {
      const maybe = accounts[i]!;
      if (!maybe.exists) continue;
      const record = {
        status: maybe.data.status as number,
        riskScore: maybe.data.riskScore as number,
        expiresAt: maybe.data.expiresAt as bigint,
      };
      if (!isConsumableListingModeration(record, now)) continue;
      return {
        moderator: params.candidates[start + i]!,
        recordPda: String(chunk[i]),
        legacy: false,
        ...record,
      };
    }
  }

  if (params.skipLegacy) return null;
  const [legacyPda] = await facade.findLegacyListingModerationPda({
    listing,
    jobSpecHash: specHash,
  });
  const legacy = await fetchMaybeListingModeration(rpc, legacyPda);
  if (
    legacy.exists &&
    params.candidates.includes(legacy.data.moderator as string)
  ) {
    const record = {
      status: legacy.data.status as number,
      riskScore: legacy.data.riskScore as number,
      expiresAt: legacy.data.expiresAt as bigint,
    };
    if (isConsumableListingModeration(record, now)) {
      return {
        moderator: legacy.data.moderator as string,
        recordPda: String(legacyPda),
        legacy: true,
        ...record,
      };
    }
  }
  return null;
}

// --------------------------------------------------------------- acquisition

/**
 * Derive an attestation service's LISTING-moderation endpoint from its task
 * attest endpoint (same origin convention as `attestorInfoUrl`):
 * `https://attest.agenc.ag/api/task-moderation/attest` →
 * `https://attest.agenc.ag/v1/moderation/listings`.
 */
export function listingsModerationUrl(attestorEndpoint: string): string {
  return `${new URL(attestorEndpoint).origin}/v1/moderation/listings`;
}

/** Raised when the store's attestor BLOCKED the listing's spec (fail closed). */
export class ListingModerationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListingModerationBlockedError";
  }
}

/** Outcome of one acquisition attempt. */
export type ListingAcquisitionOutcome =
  | { state: "acquired" }
  | { state: "blocked"; detail: string }
  | { state: "failed"; detail: string };

/**
 * Acquire a fresh LISTING attestation from the store's OWN attestation
 * service: POST the listing's on-chain `spec_uri` to the service's
 * `/v1/moderation/listings` (which fetches, scans, and — on CLEAN — records
 * the on-chain `ListingModeration` under its roster key). Never throws —
 * every failure maps to an outcome state (all of them fail closed in the
 * caller).
 */
export async function acquireListingAttestation(params: {
  /** The task attest endpoint the listings URL derives from. */
  attestorEndpoint: string;
  listing: string;
  /** The listing's on-chain spec pointer. */
  specUri: string;
  /** The listing's on-chain spec hash (hex) the verdict must bind. */
  specHashHex: string;
  fetch?: typeof fetch;
}): Promise<ListingAcquisitionOutcome> {
  if (!/^https?:\/\//i.test(params.specUri)) {
    return {
      state: "failed",
      detail:
        "Listing spec URI is not fetchable over HTTP(S); the attestation service cannot scan it.",
    };
  }
  try {
    const result = await requestListingModeration({
      specUri: params.specUri,
      listing: address(params.listing),
      endpoint: listingsModerationUrl(params.attestorEndpoint),
      ...(params.fetch ? { fetch: params.fetch } : {}),
    });
    if (result.verdict === "blocked") {
      return {
        state: "blocked",
        detail: "The attestation service BLOCKED this listing's spec.",
      };
    }
    if (result.specHash.toLowerCase() !== params.specHashHex.toLowerCase()) {
      return {
        state: "failed",
        detail:
          "The hosted spec no longer hashes to the listing's on-chain spec_hash; the acquired verdict does not bind this listing.",
      };
    }
    if (result.attestation === null) {
      return {
        state: "failed",
        detail: `The attestation service scanned the spec but recorded no attestation (verdict: ${result.verdict}).`,
      };
    }
    return { state: "acquired" };
  } catch (cause) {
    if (cause instanceof ListingModerationError) {
      return {
        state: "failed",
        detail: `Attestation service call failed: ${cause.message}`,
      };
    }
    return {
      state: "failed",
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

// ------------------------------------------------------------ hire resolver

/** What the hire-moderator GET leg resolves for a specific listing. */
export interface ListingHireModeration {
  /** The moderator to name at the hire gate. */
  moderator: string;
  /**
   * How it was resolved. `"relaxed-gate"` = moderation is disabled on-chain
   * or the P1.3 liveness deadman has relaxed the gate — no attestation is
   * required, the moderator is the store's listing-agnostic one, and no
   * acquisition ran.
   */
  source: "existing-record" | "acquired" | "relaxed-gate";
}

/**
 * How long a listing's FAILED resolution (acquisition failure, BLOCKED
 * hash/verdict, post-acquisition read timeout) is negative-cached. Prevents
 * request fan-out from repeatedly triggering the PAID acquisition path for
 * the same (listing, specHash). Short — a re-attestation attempt after the
 * window is legitimate.
 */
export const ACQUISITION_NEGATIVE_TTL_MS = 30_000;

/** Dependencies of {@link createListingHireModerationResolver}. */
export interface ListingHireModerationDeps {
  /** Cluster RPC URL (reads the listing + records + roster + config). */
  rpcUrl: string;
  /** Effective trust policy ({@link resolveListingTrustPolicy}). */
  trustPolicy: ListingTrustPolicy;
  /**
   * The store's own trusted moderator(s) — the `moderation.moderator`
   * override and/or the attestation service's signer. Resolved lazily so the
   * `/v1/info` fetch only happens when actually needed. Failures PROPAGATE —
   * a transient info failure must never shrink the trusted set, because a
   * shrunken set can trigger an unnecessary paid acquisition.
   */
  resolveStoreModerators: () => Promise<string[]>;
  /**
   * The task attest endpoint of the store's OWN attestation service; enables
   * hire-time acquisition for foreign listings. `null` disables acquisition
   * (localnet sandbox — discovery only).
   */
  attestorEndpoint: string | null;
  /**
   * The store's curation config — the resolver's catalog gate. The route is
   * public and acquisition is PAID, so resolution only runs for listings
   * this store actually carries (mirrors the POST leg's `verifyTask`
   * discipline). Omit for an uncurated full-catalog store (admits every
   * active on-chain listing — honestly its whole catalog).
   */
  curation?: Curation | undefined;
  /** Injectable seams (tests). */
  rpc?: ListingReadRpc & RosterScanRpc;
  roster?: RosterSnapshot;
  moderationConfig?: ModerationConfigSnapshot;
  fetch?: typeof fetch;
  /** Post-acquisition re-discovery attempts / delay. */
  maxResolveRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Negative-cache TTL override ({@link ACQUISITION_NEGATIVE_TTL_MS}). */
  negativeTtlMs?: number;
  /** Warning sink (defaults to `console.warn`). */
  warn?: (message: string) => void;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Build the LISTING-scoped hire-moderator resolver the activation route's
 * GET leg serves (`?listing=<pda>`). See the module header for the full
 * pipeline; the invariants:
 *
 * - the §5.2 BLOCK floor runs unconditionally and is never relaxed;
 * - a listing outside the store's catalog/curation never resolves (and
 *   never acquires);
 * - when moderation is disabled or liveness-relaxed on-chain, the store's
 *   listing-agnostic moderator is returned with NO acquisition;
 * - own-set (store moderators + global authority) discovery runs BEFORE any
 *   roster read, so an over-cap roster cannot take down own-record hires;
 *   over-cap degrades roster trust with acquisition disabled;
 * - discovered records must be UNLOCKABLE (authority-authored, or a live
 *   non-exiting roster entry exists for the author);
 * - concurrent calls for one listing single-flight; failed acquisitions are
 *   negative-cached for {@link ACQUISITION_NEGATIVE_TTL_MS};
 * - transient RPC errors propagate as-is and never trigger acquisition.
 */
export function createListingHireModerationResolver(
  deps: ListingHireModerationDeps,
): (listing: string) => Promise<ListingHireModeration> {
  // ONE rpc per resolver (not per request): a stable identity is what makes
  // the roster/config snapshot caches effective across requests.
  const rpc =
    deps.rpc ??
    (createSolanaRpc(deps.rpcUrl) as unknown as ListingReadRpc & RosterScanRpc);
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const negativeTtlMs = deps.negativeTtlMs ?? ACQUISITION_NEGATIVE_TTL_MS;

  /** Single-flight: concurrent resolutions for one listing share a promise. */
  const inflight = new Map<string, Promise<ListingHireModeration>>();
  /** Negative cache: `listing:specHash` → recent terminal failure. */
  const negative = new Map<
    string,
    { until: number; blocked: boolean; message: string }
  >();

  function failNegative(key: string, blocked: boolean, message: string): never {
    negative.set(key, { until: Date.now() + negativeTtlMs, blocked, message });
    throw blocked
      ? new ListingModerationBlockedError(message)
      : new Error(message);
  }

  /**
   * Would the hire gate accept a record authored by `moderator`? Authority
   * records unlock without a roster entry; anyone else needs a REGISTERED,
   * NON-EXITING `ModerationAttestor` entry at hire time. Checked per hit
   * with one targeted account read (or the injected roster snapshot), so a
   * revoked or exiting author's record is never named.
   */
  async function isUnlockableModerator(
    moderator: string,
    authority: string | null,
  ): Promise<boolean> {
    if (authority !== null && moderator === authority) return true;
    if (deps.roster) {
      return (
        deps.roster.active.includes(moderator) &&
        !deps.roster.exiting.has(moderator)
      );
    }
    const [pda] = await findModerationAttestorPda({
      attestor: address(moderator),
    });
    const maybe = await fetchMaybeModerationAttestor(rpc, pda);
    return maybe.exists && maybe.data.exitAt === 0n;
  }

  /** Discover, then drop hits whose author cannot unlock the gate. */
  async function discoverUnlockable(
    listing: string,
    specHashHex: string,
    candidates: readonly string[],
    authority: string | null,
    skipLegacy = false,
  ): Promise<DiscoveredListingRecord | null> {
    let remaining = [...candidates];
    while (remaining.length > 0) {
      const hit = await discoverListingModerationRecord(rpc, {
        listing,
        specHashHex,
        candidates: remaining,
        skipLegacy,
      });
      if (!hit) return null;
      if (await isUnlockableModerator(hit.moderator, authority)) return hit;
      remaining = remaining.filter((c) => c !== hit.moderator);
    }
    return null;
  }

  async function resolveInner(listing: string): Promise<ListingHireModeration> {
    const maybeListing = await fetchMaybeServiceListing(rpc, address(listing));
    if (!maybeListing.exists) {
      throw new Error("Listing does not exist on-chain.");
    }
    const specHashHex = bytesToHexLower(Array.from(maybeListing.data.specHash));
    const negKey = `${listing}:${specHashHex}`;
    const cachedFailure = negative.get(negKey);
    if (cachedFailure && cachedFailure.until > Date.now()) {
      throw cachedFailure.blocked
        ? new ListingModerationBlockedError(cachedFailure.message)
        : new Error(cachedFailure.message);
    }
    negative.delete(negKey);

    // §5.2 BLOCK floor — UNCONDITIONAL, mirrors require_content_not_blocked.
    // Never relaxed, and a blocked hash must never reach the PAID
    // acquisition path (the acquired record could never be consumed).
    if (await isSpecHashBlocked(rpc, specHashHex)) {
      failNegative(
        negKey,
        true,
        "This listing's spec hash is under a protocol takedown (moderation block) — it cannot be hired anywhere, and no attestation can unblock it.",
      );
    }

    // Catalog gate: the route is public; acquisition is a paid side effect.
    // Only resolve listings this store actually carries (state + curation).
    if ((maybeListing.data.state as number) !== 0) {
      throw new Error(
        "Listing is not active on-chain (paused or retired) — it cannot be hired.",
      );
    }
    const curateable: CurateableListing = {
      address: listing,
      providerAgent: String(maybeListing.data.providerAgent),
      category: values.decodeListingCategory(
        Uint8Array.from(Array.from(maybeListing.data.category)),
      ),
    };
    if (applyCuration([curateable], deps.curation).length === 0) {
      throw new Error(
        "This listing is not part of this store's catalog (curation) — the store does not resolve hire moderation for it.",
      );
    }

    const config =
      deps.moderationConfig ?? (await moderationConfigSnapshot(rpc));
    const storeModerators = await deps.resolveStoreModerators();

    // P1.3 liveness deadman / disabled gate: when the program requires NO
    // attestation, requiring (or paying for) one here would be wrong during
    // exactly the authority-outage scenario the deadman exists for. The
    // BLOCK floor above already ran and is never relaxed.
    const relaxed =
      config.exists &&
      (!config.enabled ||
        moderationLivenessRelaxed(
          config.updatedAt,
          config.livenessWindowSecs,
          Math.floor(Date.now() / 1000),
        ));
    if (relaxed) {
      const fallback = storeModerators.find(Boolean);
      if (!fallback) {
        throw new Error(
          "Moderation is relaxed on-chain but the store could not resolve its own moderator to name.",
        );
      }
      return { moderator: fallback, source: "relaxed-gate" };
    }

    // Own-set discovery FIRST (store moderators + the global authority) —
    // roster-independent, so a roster problem can never take down hires
    // that need no roster at all.
    const ownCandidates = [
      ...new Set(
        [...storeModerators, config.moderationAuthority ?? ""].filter(Boolean),
      ),
    ];
    if (ownCandidates.length === 0) {
      // Acquiring with zero trusted moderators could only burn an
      // attestation on a record we would refuse to consume afterwards.
      throw new Error(
        "No trusted moderators are configured for this store (own attestor unresolved and no on-chain moderation authority) — cannot resolve a hire moderator for this listing.",
      );
    }
    const ownHit = await discoverUnlockable(
      listing,
      specHashHex,
      ownCandidates,
      config.moderationAuthority,
    );
    if (ownHit) {
      return { moderator: ownHit.moderator, source: "existing-record" };
    }

    // Roster pass (any-bonded-attestor only). Over-cap DEGRADES: own-set
    // discovery above already ran, but the roster is not consulted and the
    // PAID acquisition below is disabled — a silently-shrunken trust set
    // must never trigger the paid side effect. Every other roster error
    // propagates untouched.
    let rosterDegraded = false;
    if (deps.trustPolicy === "any-bonded-attestor") {
      let snapshot: RosterSnapshot | null = null;
      try {
        snapshot = deps.roster ?? (await bondedRosterModerators(rpc));
      } catch (cause) {
        if (cause instanceof RosterCapExceededError) {
          rosterDegraded = true;
          warn(
            `[store-core] ${cause.message} Roster trust is degraded to the store's own moderators and hire-time acquisition is disabled until the roster is back under the bound.`,
          );
        } else {
          throw cause;
        }
      }
      if (snapshot) {
        const ownSet = new Set(ownCandidates);
        const rosterCandidates = snapshot.active.filter(
          (attestor) => !ownSet.has(attestor),
        );
        if (rosterCandidates.length > 0) {
          const rosterHit = await discoverUnlockable(
            listing,
            specHashHex,
            rosterCandidates,
            config.moderationAuthority,
          );
          if (rosterHit) {
            return {
              moderator: rosterHit.moderator,
              source: "existing-record",
            };
          }
        }
      }
    }
    if (rosterDegraded) {
      throw new Error(
        "No consumable trusted moderation record exists among the store's own moderators, and roster trust is temporarily degraded (attestor roster over the safety bound) — hire-time acquisition is disabled until the roster is back under the bound.",
      );
    }

    if (!deps.attestorEndpoint) {
      throw new Error(
        "No consumable trusted moderation record exists for this listing and no attestation service is configured to acquire one — it cannot be hired here.",
      );
    }
    const outcome = await acquireListingAttestation({
      attestorEndpoint: deps.attestorEndpoint,
      listing,
      specUri: maybeListing.data.specUri,
      specHashHex,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
    if (outcome.state === "blocked") {
      // FAIL CLOSED — a blocked spec is never hireable through acquisition.
      failNegative(negKey, true, outcome.detail);
    }
    if (outcome.state === "failed") {
      failNegative(
        negKey,
        false,
        `Trusted attestation could not be acquired for this listing: ${outcome.detail}`,
      );
    }
    // Attested — the record tx was sent by the attestation service; give the
    // cluster a few beats to expose the PDA before failing. The acquired
    // record is authored by the store's own service, so re-discovery only
    // needs the own set (no legacy probe — legacy seeds are frozen).
    const maxRetries = Math.max(1, deps.maxResolveRetries ?? 5);
    const sleep = deps.sleep ?? defaultSleep;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) await sleep(deps.retryDelayMs ?? 2_000);
      const acquired = await discoverUnlockable(
        listing,
        specHashHex,
        ownCandidates,
        config.moderationAuthority,
        true,
      );
      if (acquired) {
        return { moderator: acquired.moderator, source: "acquired" };
      }
    }
    failNegative(
      negKey,
      false,
      "The attestation was recorded but the trusted record did not become readable in time. Retry the hire in a moment.",
    );
  }

  return function resolveListingHireModeration(
    listing: string,
  ): Promise<ListingHireModeration> {
    const running = inflight.get(listing);
    if (running) return running;
    const resolution = resolveInner(listing).finally(() => {
      inflight.delete(listing);
    });
    inflight.set(listing, resolution);
    return resolution;
  };
}
