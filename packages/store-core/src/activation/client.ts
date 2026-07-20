/**
 * The CLIENT half of the hire→activation seam (WP-B1).
 *
 * `useHumanlessHireFlow` from the supported marketplace-react release line
 * chains `hire → hostAndModerateJobSpec → setTaskJobSpec` and refuses to sign the
 * activation unless the host returned `moderationAttested: true` with a
 * 32-byte hash and a non-empty URI. This module builds that host: a plain
 * `fetch` POST to the store's own same-origin activation route
 * ({@link DEFAULT_ACTIVATION_ROUTE}), which hosts the canonical job-spec JSON
 * and obtains the task-moderation attestation server-side.
 *
 * Invisible-by-default: the route needs zero moderation configuration — the
 * marketplace-managed attestation service is used automatically (an operator
 * MAY point `moderation.attestorEndpoint` at a self-hosted attestor as a
 * sovereignty option).
 *
 * @module activation/client
 */
import { bytesToHex, hexToBytes, HASH_HEX_RE } from "./hex.js";
import type { StoreJobSpecDraft } from "./job-spec.js";

/** The store-relative path of the template activation route. */
export const DEFAULT_ACTIVATION_ROUTE = "/api/agenc/activate-job-spec";

/**
 * What the flow hands the host after the hire lands (structurally identical to
 * marketplace-react's `HumanlessHireFlowHostInput`, declared locally so this
 * module stays hook-agnostic and server-testable).
 */
export interface StoreActivationHostInput<TJobSpec = StoreJobSpecDraft> {
  /** The minted Task PDA. */
  taskPda: string;
  /** The per-hire 32-byte task id (any readonly byte view). */
  taskId: ArrayLike<number>;
  /** The hired ServiceListing PDA. */
  listing: string;
  /** The job-spec draft to host + attest. */
  jobSpec: TJobSpec;
  /** The confirmed hire signature (audit trail). */
  hireSignature: string;
  /** Whether the provider injected the store referrer into the hire. */
  referrerInjected: boolean;
}

/** What the host resolves with (the flow's moderation-result contract). */
export interface StoreActivationHostResult {
  /** The 32-byte canonical job-spec hash to pin via `set_task_job_spec`. */
  jobSpecHash: Uint8Array;
  /** The hosted job-spec URI to pin (≤ 256 bytes on-chain). */
  jobSpecUri: string;
  /** MUST be true or the flow refuses to sign the activation. */
  moderationAttested: boolean;
  /**
   * The pubkey that signed the task-moderation attestation — the P1.2
   * `moderator` the activation transaction names (the on-chain record is
   * seeded by `task + jobSpecHash + moderator`). Required: the flow refuses
   * to sign without it.
   */
  moderator: string;
  /** Attestor detail passthrough (risk score, tx signature, …). */
  moderation?: unknown;
}

/** Options for {@link createStoreActivationHost}. */
export interface StoreActivationHostOptions {
  /** Route to POST to. Defaults to {@link DEFAULT_ACTIVATION_ROUTE}. */
  endpoint?: string;
  /** Fetch implementation override (tests). Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
}

/** The JSON body the activation route responds with. */
interface ActivationRouteResponse {
  jobSpecHashHex?: string;
  jobSpecUri?: string;
  moderationAttested?: boolean;
  moderator?: string;
  moderation?: unknown;
  error?: string;
}

/** Base58 pubkey shape (the moderator must be a real address, never guessed). */
const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Build the `hostAndModerateJobSpec` seam for `useHumanlessHireFlow`.
 *
 * @param options - Endpoint / fetch overrides ({@link StoreActivationHostOptions}).
 * @returns An async host: POSTs the hire's job-spec draft to the store's
 *   activation route and returns the flow's moderation-result contract. Any
 *   route failure throws with the route's error message, so the flow surfaces
 *   it and never signs an unattested activation.
 */
export function createStoreActivationHost<TJobSpec = StoreJobSpecDraft>(
  options: StoreActivationHostOptions = {},
): (
  input: StoreActivationHostInput<TJobSpec>,
) => Promise<StoreActivationHostResult> {
  const endpoint = options.endpoint ?? DEFAULT_ACTIVATION_ROUTE;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return async function hostAndModerateJobSpec(
    input: StoreActivationHostInput<TJobSpec>,
  ): Promise<StoreActivationHostResult> {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        taskPda: String(input.taskPda),
        taskId: bytesToHex(Uint8Array.from(input.taskId as ArrayLike<number>)),
        listing: String(input.listing),
        jobSpec: input.jobSpec,
        hireSignature: input.hireSignature,
        referrerInjected: input.referrerInjected,
      }),
    });

    const body = (await response.json().catch(() => null)) as
      | ActivationRouteResponse
      | null;
    if (!response.ok || !body) {
      throw new Error(
        body?.error ??
          `Job-spec activation route failed (${response.status}). The hire is on-chain; retry activation from the dashboard.`,
      );
    }
    if (!body.jobSpecHashHex || !HASH_HEX_RE.test(body.jobSpecHashHex)) {
      throw new Error("Activation route returned an invalid jobSpecHashHex.");
    }
    if (!body.jobSpecUri) {
      throw new Error("Activation route returned no jobSpecUri.");
    }
    if (typeof body.moderator !== "string" || !PUBKEY_RE.test(body.moderator)) {
      // Fail CLOSED (P1.2): without the moderator the activation cannot name
      // the attestation record it consumes. Never guess one.
      throw new Error(
        "Activation route returned no moderator pubkey (required by the P1.2 " +
          "gates). Update @tetsuo-ai/store-core and, if self-hosting the " +
          "attestor, upgrade it to agenc-moderation-api >= 0.2.1 or set " +
          "moderation.moderator in agenc.config.ts.",
      );
    }
    return {
      jobSpecHash: hexToBytes(body.jobSpecHashHex.toLowerCase()),
      jobSpecUri: body.jobSpecUri,
      moderationAttested: body.moderationAttested === true,
      moderator: body.moderator,
      moderation: body.moderation ?? null,
    };
  };
}

/**
 * Per-session cache for {@link fetchStoreHireModerator}, keyed by
 * `endpoint#listing`. Successful resolutions only — failures (including 422
 * BLOCKED) are never cached here.
 */
const hireModeratorCache = new Map<string, string>();

/** Options for {@link fetchStoreHireModerator}. */
export interface FetchStoreHireModeratorOptions
  extends StoreActivationHostOptions {
  /**
   * The ServiceListing PDA being hired (§12 roster-trust rail). When set, the
   * route resolves the moderator whose consumable record ACTUALLY EXISTS for
   * THIS listing (own attestor, global authority, or — under
   * `moderation.trustPolicy: "any-bonded-attestor"` — any bonded roster
   * attestor), acquiring a fresh attestation from the store's own service on
   * a miss. Omit for the legacy listing-agnostic lookup (pre-rail stores).
   */
  listing?: string;
}

/**
 * Resolve the moderator pubkey the P1.2 HIRE gates name
 * (`hire_from_listing[_humanless]`), for flows where no fresh attestation
 * response exists yet: `GET` the store's own activation route. Pass
 * `listing` (ALWAYS pass it when hiring a specific listing) so the store
 * resolves per-listing via the §12 roster-trust rail — the listing-agnostic
 * answer can name a moderator that holds NO record for the listing, which
 * reverts on-chain after signing. Cached per (endpoint, listing) session.
 *
 * @param options - Endpoint / listing / fetch overrides.
 * @returns The base58 moderator pubkey. Throws (fail-closed) when the store
 *   cannot name one — a guessed moderator would only fail on-chain later.
 */
export async function fetchStoreHireModerator(
  options: FetchStoreHireModeratorOptions = {},
): Promise<string> {
  const endpoint = options.endpoint ?? DEFAULT_ACTIVATION_ROUTE;
  const listing = options.listing?.trim();
  const url = listing
    ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}listing=${encodeURIComponent(listing)}`
    : endpoint;
  const cacheKey = `${endpoint}#${listing ?? ""}`;
  const cached = hireModeratorCache.get(cacheKey);
  if (cached) return cached;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const response = await fetchImpl(url, { method: "GET" });
  const body = (await response.json().catch(() => null)) as {
    moderator?: unknown;
    blocked?: boolean;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(
      body?.error ??
        `Hire moderator lookup failed (${response.status}). The store's activation route could not name the P1.2 moderator.`,
    );
  }
  const moderator =
    typeof body?.moderator === "string" ? body.moderator.trim() : "";
  if (!PUBKEY_RE.test(moderator)) {
    throw new Error(
      "The store's activation route returned no moderator pubkey (required " +
        "by the P1.2 hire gates). Update @tetsuo-ai/store-core and your " +
        "attestation service (agenc-moderation-api >= 0.2.1), or set " +
        "moderation.moderator in agenc.config.ts.",
    );
  }
  hireModeratorCache.set(cacheKey, moderator);
  return moderator;
}
