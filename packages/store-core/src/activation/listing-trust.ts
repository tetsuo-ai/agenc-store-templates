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
 * - a BLOCKED acquisition verdict throws {@link ListingModerationBlockedError};
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
  fetchMaybeServiceListing,
  findListingModerationPda,
  getModerationAttestorDecoder,
  ListingModerationError,
  MODERATION_ATTESTOR_DISCRIMINATOR,
  requestListingModeration,
} from "@tetsuo-ai/marketplace-sdk";

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
 * economically-anomalous roster, and we FAIL CLOSED with an honest error
 * instead of quietly dropping entries (a truncated roster would make trust
 * decisions on a partial view). Also bounds per-hire discovery work:
 * candidate records are probed in {@link DISCOVERY_BATCH_SIZE}-address
 * `getMultipleAccounts` batches, so a worst-case full miss costs
 * `ceil(512 / 100) + 1` batched RPC reads.
 */
export const MAX_ROSTER_ATTESTORS = 512;

/** `getMultipleAccounts` batch bound for candidate-record probes. */
const DISCOVERY_BATCH_SIZE = 100;

/**
 * Scan the on-chain moderation-attestor roster (gPA by discriminator) and
 * decode each entry's exit state (uncached — see
 * {@link bondedRosterModerators}).
 *
 * Strict by design:
 * - more than {@link MAX_ROSTER_ATTESTORS} entries → throws (no silent
 *   truncation);
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
    throw new Error(
      `Moderation-attestor roster scan returned ${raw.value.length} entries, over the MAX_ROSTER_ATTESTORS bound (${MAX_ROSTER_ATTESTORS}). Refusing to make trust decisions on a truncated roster — use trustPolicy "edge-list" or raise the bound in a store-core update.`,
    );
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

/** Test seam: drop all roster caches. */
export function __clearListingTrustCachesForTests(): void {
  rosterCaches = new WeakMap();
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
 * candidate list itself.
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
  /** How it was resolved. */
  source: "existing-record" | "acquired";
}

/** Dependencies of {@link createListingHireModerationResolver}. */
export interface ListingHireModerationDeps {
  /** Cluster RPC URL (reads the listing + records + roster). */
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
  /** Injectable seams (tests). */
  rpc?: ListingReadRpc & RosterScanRpc;
  roster?: RosterSnapshot;
  fetch?: typeof fetch;
  /** Post-acquisition re-discovery attempts / delay. */
  maxResolveRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Build the LISTING-scoped hire-moderator resolver the activation route's
 * GET leg serves (`?listing=<pda>`):
 *
 *   read listing (spec pointer) → policy-aware trusted discovery
 *   (consumable records only) → (definitive miss) acquire from OWN attestor
 *   → re-discover → moderator.
 *
 * Fail-closed: throws {@link ListingModerationBlockedError} on a BLOCKED
 * verdict and a plain Error when no trusted record can be resolved — the
 * client never names a guessed moderator and never signs. Transient RPC
 * errors propagate as-is and never trigger acquisition.
 */
export function createListingHireModerationResolver(
  deps: ListingHireModerationDeps,
): (listing: string) => Promise<ListingHireModeration> {
  // ONE rpc per resolver (not per request): a stable identity is what makes
  // the roster snapshot cache effective across requests.
  const rpc =
    deps.rpc ??
    (createSolanaRpc(deps.rpcUrl) as unknown as ListingReadRpc & RosterScanRpc);

  return async function resolveListingHireModeration(
    listing: string,
  ): Promise<ListingHireModeration> {
    const maybeListing = await fetchMaybeServiceListing(rpc, address(listing));
    if (!maybeListing.exists) {
      throw new Error("Listing does not exist on-chain.");
    }
    const specHashHex = bytesToHexLower(Array.from(maybeListing.data.specHash));
    const storeModerators = await deps.resolveStoreModerators();
    const candidates = await trustedListingModerators({
      rpc,
      storeModerators,
      trustPolicy: deps.trustPolicy,
      ...(deps.roster ? { roster: deps.roster } : {}),
    });
    if (candidates.length === 0) {
      // Acquiring with zero trusted moderators could only burn an attestation
      // on a record we would refuse to consume afterwards.
      throw new Error(
        "No trusted moderators are configured for this store (own attestor unresolved and the roster added none) — cannot resolve a hire moderator for this listing.",
      );
    }
    const discover = () =>
      discoverListingModerationRecord(rpc, {
        listing,
        specHashHex,
        candidates,
      });

    const existing = await discover();
    if (existing) {
      return { moderator: existing.moderator, source: "existing-record" };
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
      throw new ListingModerationBlockedError(outcome.detail);
    }
    if (outcome.state === "failed") {
      throw new Error(
        `Trusted attestation could not be acquired for this listing: ${outcome.detail}`,
      );
    }
    // Attested — the record tx was sent by the attestation service; give the
    // cluster a few beats to expose the PDA before failing.
    const maxRetries = Math.max(1, deps.maxResolveRetries ?? 5);
    const sleep = deps.sleep ?? defaultSleep;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) await sleep(deps.retryDelayMs ?? 2_000);
      const acquired = await discover();
      if (acquired) {
        return { moderator: acquired.moderator, source: "acquired" };
      }
    }
    throw new Error(
      "The attestation was recorded but the trusted record did not become readable in time. Retry the hire in a moment.",
    );
  };
}
