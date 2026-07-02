/**
 * The real-funds go-live checklist behind `allowMainnet: true` (WP-B1).
 *
 * `network: "mainnet"` requires the deliberate `allowMainnet: true` opt-in;
 * this module is the machine-checkable half of the checklist a deployer walks
 * BEFORE setting it (the prose half is `docs/GO_LIVE.md`). It validates the
 * env + RPC configuration a real-funds store needs.
 *
 * **Deliberately absent: moderation setup.** Per the invisible-by-default rule
 * the default hire→activation flow requires ZERO moderation configuration —
 * task attestation is marketplace-managed. The only moderation-adjacent field
 * (`moderation.attestorEndpoint`) is an optional sovereignty override and is
 * never required to go live.
 *
 * @module config/go-live
 */
import type { StoreConfig } from "./schema.js";

/** One go-live check result. */
export interface GoLiveCheck {
  /** Stable id for tooling. */
  id: string;
  /** What is being checked. */
  label: string;
  /** Whether the check passes. */
  ok: boolean;
  /** Actionable message when the check fails (null when ok). */
  message: string | null;
}

/** The result of {@link checkMainnetGoLive}. */
export interface GoLiveResult {
  /** True when every check passes. */
  ready: boolean;
  /** Every check, pass or fail. */
  checks: GoLiveCheck[];
}

/** Environment slice consulted by the checklist (injectable for tests). */
export interface GoLiveEnv {
  /** Optional RPC override (`AGENC_RPC_URL`). */
  AGENC_RPC_URL?: string | undefined;
  /** Operator-provided DURABLE job-spec directory (e.g. a mounted volume). */
  AGENC_JOB_SPEC_DIR?: string | undefined;
  /** Set by Vercel builds/functions. */
  VERCEL?: string | undefined;
  /** Set by Netlify builds/functions. */
  NETLIFY?: string | undefined;
  /** Set inside AWS Lambda (raw or behind serverless frameworks). */
  AWS_LAMBDA_FUNCTION_NAME?: string | undefined;
  /** Set by Cloud Run / Cloud Functions gen2. */
  K_SERVICE?: string | undefined;
  /** Set by Cloudflare Pages builds. */
  CF_PAGES?: string | undefined;
}

/**
 * Detect a serverless/ephemeral-filesystem hosting platform from its
 * well-known environment markers. On these platforms the default FILE-BACKED
 * job-spec hosting is broken by construction: the function filesystem is
 * read-only or per-instance, so a POSTed spec either fails to write or is not
 * readable by the GET route that serves the on-chain `job_spec_uri`.
 *
 * Pure env sniffing (client-bundle safe — no node imports). Returns the
 * platform name, or `null` when none is detected.
 */
export function detectEphemeralHosting(env: GoLiveEnv): string | null {
  if (env.VERCEL) return "Vercel";
  if (env.NETLIFY) return "Netlify";
  if (env.AWS_LAMBDA_FUNCTION_NAME) return "AWS Lambda";
  if (env.K_SERVICE) return "Google Cloud Run";
  if (env.CF_PAGES) return "Cloudflare Pages";
  return null;
}

function check(
  id: string,
  label: string,
  ok: boolean,
  message: string,
): GoLiveCheck {
  return { id, label, ok, message: ok ? null : message };
}

/**
 * Run the machine-checkable mainnet go-live checklist against a validated
 * store config + deploy environment.
 *
 * Checks (env validation + RPC config only — NO moderation setup):
 * 1. `allowMainnet: true` is set (the deliberate real-funds opt-in).
 * 2. The store has a production read path: either `api.baseUrl` is a real
 *    HTTPS indexer or an explicit `AGENC_RPC_URL` override is provided —
 *    a localhost read path can never serve a real-funds store.
 * 3. `seo.siteUrl` is a public HTTPS origin (checkout + job-spec hosting URLs
 *    derive from it; a localhost siteUrl would emit unreachable job-spec
 *    pointers on-chain).
 * 4. A referrer wallet is configured (already schema-validated base58) so the
 *    owner's referral leg is actually earning.
 *
 * @param config - The validated store config.
 * @param env - The deploy environment slice (defaults to `process.env`).
 * @returns A {@link GoLiveResult}; render `checks` verbatim to the operator.
 */
export function checkMainnetGoLive(
  config: StoreConfig,
  env: GoLiveEnv = typeof process !== "undefined"
    ? (process.env as GoLiveEnv)
    : {},
): GoLiveResult {
  const checks: GoLiveCheck[] = [];

  checks.push(
    check(
      "allow-mainnet",
      "Deliberate real-funds opt-in (`allowMainnet: true`)",
      config.network !== "mainnet" || config.allowMainnet === true,
      "Set `allowMainnet: true` in agenc.config.ts — mainnet points this store at real funds and requires the explicit opt-in.",
    ),
  );

  const baseUrl = config.api.baseUrl;
  const isLocalBase =
    baseUrl.includes("127.0.0.1") || baseUrl.includes("localhost");
  const httpsBase = baseUrl.startsWith("https://");
  const rpcOverride = (env.AGENC_RPC_URL ?? "").trim();
  const httpsRpcOverride =
    rpcOverride.startsWith("https://") &&
    !rpcOverride.includes("127.0.0.1") &&
    !rpcOverride.includes("localhost");
  checks.push(
    check(
      "read-path",
      "Production read path (HTTPS indexer or AGENC_RPC_URL)",
      (httpsBase && !isLocalBase) || httpsRpcOverride,
      "Point `api.baseUrl` at an HTTPS indexer (or set AGENC_RPC_URL to a production HTTPS RPC). A localhost read path cannot serve a real-funds store.",
    ),
  );

  const siteUrl = config.seo.siteUrl;
  checks.push(
    check(
      "site-url",
      "Public HTTPS siteUrl (SEO + hosted job-spec URLs derive from it)",
      siteUrl.startsWith("https://") &&
        !siteUrl.includes("localhost") &&
        !siteUrl.includes("127.0.0.1"),
      "Set `seo.siteUrl` to the store's public HTTPS origin — job-spec pointers pinned on-chain are served from it.",
    ),
  );

  checks.push(
    check(
      "referrer",
      "Referrer wallet configured (the owner's earning leg)",
      config.referrer.wallet.length > 0,
      "Configure `referrer.wallet` — it is the wallet that earns the store's referral fee on every hire.",
    ),
  );

  const ephemeralPlatform = detectEphemeralHosting(env);
  checks.push(
    check(
      "job-spec-hosting",
      "Durable job-spec hosting (activation pins its URI on-chain)",
      ephemeralPlatform === null || Boolean(env.AGENC_JOB_SPEC_DIR?.trim()),
      `This deploy runs on ${ephemeralPlatform ?? "a serverless platform"}, where the default file-backed job-spec hosting is ephemeral: every hire's activation would fail (or its on-chain job_spec_uri would 404). Set AGENC_JOB_SPEC_DIR to a mounted persistent volume, or swap the storeJobSpec seam in src/app/api/agenc/activate-job-spec/route.ts for durable object storage. See docs/GO_LIVE.md § job-spec hosting.`,
    ),
  );

  return { ready: checks.every((c) => c.ok), checks };
}
