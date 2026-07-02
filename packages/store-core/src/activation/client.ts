/**
 * The CLIENT half of the hire→activation seam (WP-B1).
 *
 * `useHumanlessHireFlow` (marketplace-react 0.2.x) chains
 * `hire → hostAndModerateJobSpec → setTaskJobSpec` and refuses to sign the
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
  moderation?: unknown;
  error?: string;
}

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
    return {
      jobSpecHash: hexToBytes(body.jobSpecHashHex.toLowerCase()),
      jobSpecUri: body.jobSpecUri,
      moderationAttested: body.moderationAttested === true,
      moderation: body.moderation ?? null,
    };
  };
}
