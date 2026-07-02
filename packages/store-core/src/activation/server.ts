/**
 * `@tetsuo-ai/store-core/activation/server` — the SERVER half of the
 * hire→activation seam (WP-B1). This is the store's own activation route:
 *
 *   1. normalize + bound the untrusted job-spec draft,
 *   2. canonicalize + sha-256 hash it (the SDK's `values.canonicalJobSpec*`,
 *      byte-identical to what verifiers recompute),
 *   3. HOST the canonical JSON (file-backed by default, served back from the
 *      store's own `/api/agenc/job-specs/[hash]` route),
 *   4. obtain the CLEAN task-moderation attestation for `(task, hash)`,
 *   5. respond with `{ jobSpecHashHex, jobSpecUri, moderationAttested }` so the
 *      browser can sign `set_task_job_spec`.
 *
 * ## Invisible-by-default (founder rule, 2026-07-01)
 *
 * Moderation attestation is NEVER a setup step. {@link resolveTaskAttestor}
 * defaults to the marketplace-managed attestation service
 * ({@link DEFAULT_TASK_ATTESTOR_ENDPOINT}) with zero configuration; on
 * localnet it signs the attestation directly with the local sandbox's
 * moderation-authority key (dev-only). The ONLY override is the sovereignty
 * field `moderation.attestorEndpoint` for operators who run their own attestor.
 *
 * Node-only (fs, sdk signing) — never import from a client bundle; the
 * client half lives at `@tetsuo-ai/store-core/activation`.
 *
 * @module activation/server
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createMarketplaceClient,
  facade,
  values,
} from "@tetsuo-ai/marketplace-sdk";
import { address, createKeyPairSignerFromBytes } from "@solana/kit";
import { HASH_HEX_RE } from "./hex.js";
import {
  normalizeStoreJobSpec,
  type StoreJobSpecPayload,
} from "./job-spec.js";
import type { StoreConfig } from "../config/schema.js";

/**
 * The marketplace-managed task-moderation attestation endpoint used when no
 * sovereignty override is configured. Marketplace-managed means: no user-held
 * token, no signup, no configuration — the store's activation route calls it
 * automatically for every hire.
 */
export const DEFAULT_TASK_ATTESTOR_ENDPOINT =
  "https://marketplace.agenc.tech/api/task-moderation/attest";

/** Default request-size bound for the activation route. */
export const DEFAULT_MAX_REQUEST_BYTES = 128 * 1024;
/** Default canonical-JSON bound (what gets hosted + hashed). */
export const DEFAULT_MAX_CANONICAL_BYTES = 64 * 1024;

const PDA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ---------------------------------------------------------------- job hosting

/** What a job-spec store receives. */
export interface StoreJobSpecHostInput {
  /** The Task PDA. */
  taskPda: string;
  /** Lowercase 32-byte hex of the canonical hash. */
  jobSpecHashHex: string;
  /** The normalized payload. */
  payload: StoreJobSpecPayload;
  /** The canonical JSON (host THESE bytes; the hash covers them). */
  canonicalJson: string;
}

/** What a job-spec store returns. */
export interface StoredJobSpec {
  /** The public URI the canonical JSON is served from (≤ 256 bytes). */
  uri: string;
}

/** The hosting seam. */
export type StoreJobSpecFn = (
  input: StoreJobSpecHostInput,
) => Promise<StoredJobSpec>;

/**
 * File-backed job-spec hosting (the default): writes
 * `<directory>/<hash>.json` and returns `<publicBaseUrl>/<hash>`. Pair it with
 * a GET route that serves {@link readHostedJobSpec} from the same directory.
 */
export function createFileJobSpecStore(config: {
  /** Directory to write canonical JSON documents into. */
  directory: string;
  /** Public base URL the GET route serves from (no trailing slash needed). */
  publicBaseUrl: string;
}): StoreJobSpecFn {
  const baseUrl = config.publicBaseUrl.replace(/\/+$/, "");
  if (!config.directory.trim()) {
    throw new Error("createFileJobSpecStore: directory is required.");
  }
  if (!baseUrl) {
    throw new Error("createFileJobSpecStore: publicBaseUrl is required.");
  }
  return async function storeJobSpec(input): Promise<StoredJobSpec> {
    if (!HASH_HEX_RE.test(input.jobSpecHashHex)) {
      throw new Error("storeJobSpec: jobSpecHashHex must be 32-byte hex.");
    }
    await mkdir(config.directory, { recursive: true });
    const hash = input.jobSpecHashHex.toLowerCase();
    await writeFile(
      path.join(config.directory, `${hash}.json`),
      `${input.canonicalJson}\n`,
      "utf8",
    );
    return { uri: `${baseUrl}/${hash}` };
  };
}

/**
 * Read a hosted canonical job-spec JSON back (the GET route's body), or `null`
 * when the hash was never hosted here. The hash is validated before any path
 * join, so a traversal can never escape the directory.
 */
export async function readHostedJobSpec(config: {
  directory: string;
  hashHex: string;
}): Promise<string | null> {
  if (!HASH_HEX_RE.test(config.hashHex)) return null;
  try {
    return await readFile(
      path.join(config.directory, `${config.hashHex.toLowerCase()}.json`),
      "utf8",
    );
  } catch {
    return null;
  }
}

/**
 * In-memory job-spec hosting (tests + ephemeral sandboxes). Exposes the
 * backing map so a test can assert exactly what was hosted.
 */
export function createMemoryJobSpecStore(config: { publicBaseUrl: string }): {
  storeJobSpec: StoreJobSpecFn;
  /** hashHex (lowercase) → canonical JSON. */
  hosted: Map<string, string>;
} {
  const baseUrl = config.publicBaseUrl.replace(/\/+$/, "");
  const hosted = new Map<string, string>();
  return {
    hosted,
    async storeJobSpec(input): Promise<StoredJobSpec> {
      const hash = input.jobSpecHashHex.toLowerCase();
      hosted.set(hash, input.canonicalJson);
      return { uri: `${baseUrl}/${hash}` };
    },
  };
}

// ------------------------------------------------------------- attestor seam

/** What an attestor receives. */
export interface TaskModerationInput extends StoreJobSpecHostInput {
  /** The hosted URI (already resolved by the store). */
  jobSpecUri: string;
}

/** What an attestor returns. */
export interface TaskModerationResult {
  /** True only when a CLEAN attestation was recorded for `(task, hash)`. */
  attested: boolean;
  /** Attestor detail passthrough. */
  moderation?: unknown;
  /** The on-chain record signature, when the attestor broadcast one. */
  txSignature?: string | null;
}

/** The attestation seam. */
export type AttestTaskModerationFn = (
  input: TaskModerationInput,
) => Promise<TaskModerationResult>;

/**
 * The remote attestor: POSTs the canonical job spec to an attestation
 * endpoint (marketplace-managed by default, or the sovereignty override).
 * Secrets are never taken from chat/config prose — `bearerToken`, when a
 * custom protected attestor needs one, comes from the deploy env.
 */
export function createRemoteTaskModerationAttestor(config: {
  endpoint: string;
  bearerToken?: string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): AttestTaskModerationFn {
  const url = config.endpoint.trim();
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? 10_000;
  if (!url) {
    throw new Error("createRemoteTaskModerationAttestor: endpoint is required.");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      "createRemoteTaskModerationAttestor: timeoutMs must be positive.",
    );
  }

  return async function attestTaskModeration(input) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...(config.bearerToken
            ? { authorization: `Bearer ${config.bearerToken}` }
            : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          taskPda: input.taskPda,
          jobSpecHash: input.jobSpecHashHex,
          jobSpecUri: input.jobSpecUri,
          jobSpec: input.payload,
          jobSpecCanonicalJson: input.canonicalJson,
        }),
      });
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new Error("Task moderation endpoint timed out.");
      }
      throw cause;
    } finally {
      clearTimeout(timeout);
    }

    const body = (await response.json().catch(() => null)) as {
      attested?: boolean;
      moderation?: unknown;
      txSignature?: string | null;
      error?: string | { message?: string; reason?: string };
    } | null;
    if (!response.ok) {
      const fallback = `Task moderation endpoint failed (${response.status}).`;
      const err = body?.error;
      throw new Error(
        typeof err === "string"
          ? err
          : (err?.reason ?? err?.message ?? fallback),
      );
    }
    return {
      attested: body?.attested === true,
      moderation: body?.moderation ?? null,
      txSignature: body?.txSignature ?? null,
    };
  };
}

/** CLEAN attestation constants (status 0, risk 0, never expires). */
const CLEAN_ATTESTATION = {
  status: 0,
  riskScore: 0,
  categoryMask: 0n,
  policyHash: new Uint8Array(32),
  scannerHash: new Uint8Array(32),
  expiresAt: 0n,
} as const;

/**
 * The LOCALNET-ONLY direct attestor: signs `record_task_moderation` itself
 * with the local sandbox's moderation-authority keypair (written by the
 * agenc-protocol localnet stack to `.localnet/keys/moderator.json`). This is
 * what makes the zero-config local hire→activation flow real — there is no
 * HTTP attestor on a laptop, but the dev sandbox's moderation key is local by
 * design.
 *
 * Refuses to construct for any network other than `localnet`.
 */
export function createLocalSandboxTaskAttestor(config: {
  network: StoreConfig["network"];
  rpcUrl: string;
  moderatorKeypairPath: string;
}): AttestTaskModerationFn {
  if (config.network !== "localnet") {
    throw new Error(
      "createLocalSandboxTaskAttestor is localnet-only: it signs with the dev sandbox moderation key. Use the marketplace-managed attestor (default) or moderation.attestorEndpoint on public clusters.",
    );
  }
  return async function attestTaskModeration(input) {
    const raw = JSON.parse(
      await readFile(config.moderatorKeypairPath, "utf8"),
    ) as number[];
    const signer = await createKeyPairSignerFromBytes(Uint8Array.from(raw));
    const client = createMarketplaceClient({
      rpcUrl: config.rpcUrl,
      signer,
    });
    const result = await client.send([
      await facade.recordTaskModeration({
        moderator: signer,
        task: address(input.taskPda),
        jobSpecHash: values.hexToBytes(input.jobSpecHashHex),
        ...CLEAN_ATTESTATION,
      }),
    ]);
    return {
      attested: true,
      moderation: { source: "local-sandbox", status: "CLEAN" },
      txSignature: result.signature,
    };
  };
}

// ------------------------------------------------------------ route handler

/** Dependencies of {@link createActivateJobSpecHandler}. */
export interface ActivateJobSpecHandlerDeps {
  /** Hosting seam. */
  storeJobSpec: StoreJobSpecFn;
  /** Attestation seam. */
  attestTaskModeration: AttestTaskModerationFn;
  /** Request-size bound. Defaults to {@link DEFAULT_MAX_REQUEST_BYTES}. */
  maxRequestBytes?: number;
  /** Canonical-JSON bound. Defaults to {@link DEFAULT_MAX_CANONICAL_BYTES}. */
  maxCanonicalBytes?: number;
}

/** The success body of the activation route. */
export interface ActivateJobSpecResponse {
  jobSpecHashHex: string;
  jobSpecUri: string;
  moderationAttested: boolean;
  moderation?: unknown;
  txSignature?: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && Number.isFinite(Number(declared)) && Number(declared) > maxBytes) {
    throw new RangeError("Request body is too large.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new RangeError("Request body is too large.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SyntaxError("Request body must be valid JSON.");
  }
}

/**
 * Build the activation route handler (a fetch-style `(Request) => Response`
 * that plugs straight into a Next.js route `POST` export).
 *
 * Contract (mirrors `useHumanlessHireFlow`'s host seam): the response's
 * `moderationAttested` MUST be `true`, the hash 32 bytes, the URI non-empty —
 * otherwise the browser flow throws and never signs the activation.
 */
export function createActivateJobSpecHandler({
  storeJobSpec,
  attestTaskModeration,
  maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
  maxCanonicalBytes = DEFAULT_MAX_CANONICAL_BYTES,
}: ActivateJobSpecHandlerDeps): (request: Request) => Promise<Response> {
  return async function activateJobSpec(request: Request): Promise<Response> {
    if (request.method && request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }

    let body: unknown;
    try {
      body = await readBoundedJson(request, maxRequestBytes);
    } catch (cause) {
      if (cause instanceof RangeError) return json({ error: cause.message }, 413);
      return json({ error: "Request body must be valid JSON." }, 400);
    }

    let taskPda: string;
    let payload: StoreJobSpecPayload;
    let canonicalJson: string;
    let jobSpecHashHex: string;
    try {
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new Error("Request body must be a JSON object.");
      }
      const record = body as Record<string, unknown>;
      taskPda =
        typeof record.taskPda === "string" ? record.taskPda.trim() : "";
      const listing =
        typeof record.listing === "string" ? record.listing.trim() : "";
      if (!PDA_RE.test(taskPda)) {
        throw new Error("taskPda must be a base58 task PDA.");
      }
      if (!PDA_RE.test(listing)) {
        throw new Error("listing must be a base58 listing PDA.");
      }
      payload = normalizeStoreJobSpec(taskPda, listing, record.jobSpec);
      canonicalJson = values.canonicalJobSpecJson(payload);
      if (
        new TextEncoder().encode(canonicalJson).byteLength > maxCanonicalBytes
      ) {
        return json({ error: "Canonical job spec is too large." }, 413);
      }
      jobSpecHashHex = (await values.canonicalJobSpecHash(payload)).hex;
    } catch (cause) {
      return json(
        { error: cause instanceof Error ? cause.message : String(cause) },
        400,
      );
    }

    let stored: StoredJobSpec;
    try {
      stored = await storeJobSpec({
        taskPda,
        jobSpecHashHex,
        payload,
        canonicalJson,
      });
    } catch {
      return json({ error: "Job-spec hosting failed." }, 502);
    }
    if (!stored.uri) {
      return json({ error: "Job-spec hosting returned no URI." }, 502);
    }

    let moderation: TaskModerationResult;
    try {
      moderation = await attestTaskModeration({
        taskPda,
        jobSpecHashHex,
        payload,
        canonicalJson,
        jobSpecUri: stored.uri,
      });
    } catch (cause) {
      return json(
        {
          error:
            cause instanceof Error
              ? cause.message
              : "Task moderation attestation failed.",
        },
        502,
      );
    }
    if (moderation.attested !== true) {
      return json(
        {
          error: "Task moderation did not attest this job spec.",
          moderation: moderation.moderation ?? null,
        },
        422,
      );
    }

    const response: ActivateJobSpecResponse = {
      jobSpecHashHex,
      jobSpecUri: stored.uri,
      moderationAttested: true,
      moderation: moderation.moderation ?? null,
      txSignature: moderation.txSignature ?? null,
    };
    return json(response);
  };
}

// -------------------------------------------------- zero-config resolution

/** Environment slice consulted by {@link resolveActivationBackend}. */
export interface ActivationEnv {
  /** RPC override (also used by the localnet sandbox attestor). */
  AGENC_RPC_URL?: string | undefined;
  /** Bearer token for a PROTECTED custom attestor (sovereignty setups only). */
  AGENC_TASK_ATTESTOR_TOKEN?: string | undefined;
  /** agenc-protocol checkout override (localnet sandbox key discovery). */
  AGENC_PROTOCOL_DIR?: string | undefined;
  /** Explicit localnet moderator keypair path override. */
  AGENC_MODERATOR_KEYPAIR?: string | undefined;
}

/** The resolved backend of a store's activation route. */
export interface ActivationBackend {
  storeJobSpec: StoreJobSpecFn;
  attestTaskModeration: AttestTaskModerationFn;
  /** Where hosted specs are written (for the GET route). */
  jobSpecDirectory: string;
  /** Which attestor was resolved (observability, not behavior). */
  attestor: "marketplace-managed" | "sovereignty-override" | "local-sandbox";
}

/** Default on-disk hosting directory, relative to the app cwd. */
export const DEFAULT_JOB_SPEC_DIRECTORY = ".agenc/job-specs";

function defaultLocalnetModeratorKeyPath(env: ActivationEnv): string {
  const protocolDir =
    env.AGENC_PROTOCOL_DIR ?? path.resolve(process.cwd(), "../../agenc-protocol");
  return path.join(protocolDir, ".localnet/keys/moderator.json");
}

/**
 * Resolve the activation route's hosting + attestation backend from the store
 * config with ZERO moderation configuration (the invisible-by-default rule):
 *
 * - hosting: file-backed under {@link DEFAULT_JOB_SPEC_DIRECTORY}, served from
 *   `<siteUrl>/api/agenc/job-specs/<hash>`;
 * - attestor: `moderation.attestorEndpoint` (sovereignty override) when set,
 *   else the local sandbox signer on `localnet`, else the marketplace-managed
 *   endpoint ({@link DEFAULT_TASK_ATTESTOR_ENDPOINT}).
 *
 * @param config - The validated store config.
 * @param env - Deploy-env slice (defaults to `process.env`).
 */
export function resolveActivationBackend(
  config: StoreConfig,
  env: ActivationEnv = typeof process !== "undefined"
    ? (process.env as ActivationEnv)
    : {},
): ActivationBackend {
  const jobSpecDirectory = path.resolve(
    process.cwd(),
    DEFAULT_JOB_SPEC_DIRECTORY,
  );
  const storeJobSpec = createFileJobSpecStore({
    directory: jobSpecDirectory,
    publicBaseUrl: `${config.seo.siteUrl.replace(/\/+$/, "")}/api/agenc/job-specs`,
  });

  const override = config.moderation?.attestorEndpoint;
  if (override) {
    return {
      storeJobSpec,
      jobSpecDirectory,
      attestor: "sovereignty-override",
      attestTaskModeration: createRemoteTaskModerationAttestor({
        endpoint: override,
        bearerToken: env.AGENC_TASK_ATTESTOR_TOKEN,
      }),
    };
  }

  if (config.network === "localnet") {
    return {
      storeJobSpec,
      jobSpecDirectory,
      attestor: "local-sandbox",
      attestTaskModeration: createLocalSandboxTaskAttestor({
        network: config.network,
        rpcUrl: env.AGENC_RPC_URL ?? "http://127.0.0.1:8899",
        moderatorKeypairPath:
          env.AGENC_MODERATOR_KEYPAIR ?? defaultLocalnetModeratorKeyPath(env),
      }),
    };
  }

  return {
    storeJobSpec,
    jobSpecDirectory,
    attestor: "marketplace-managed",
    attestTaskModeration: createRemoteTaskModerationAttestor({
      endpoint: DEFAULT_TASK_ATTESTOR_ENDPOINT,
    }),
  };
}
