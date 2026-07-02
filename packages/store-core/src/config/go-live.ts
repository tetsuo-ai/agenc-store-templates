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

  return { ready: checks.every((c) => c.ok), checks };
}
