/**
 * Scaffold options + validation (PLAN_2 C4). The CLI gathers these from flags or
 * prompts, validates them with `store-core`'s `safeDefineStore` (so a bad
 * referrer wallet or over-cap fee is caught BEFORE any files are written), and
 * renders the filled `agenc.config.ts`.
 *
 * @module config
 */
import { safeDefineStore, type StoreNetwork } from "@tetsuo-ai/store-core/config";

/** The three template variants this CLI can scaffold. */
export const TEMPLATE_VARIANTS = [
  "marketplace-store",
  "provider-storefront",
  "vertical-store",
] as const;

/** A template variant id. */
export type TemplateVariant = (typeof TEMPLATE_VARIANTS)[number];

/** Type guard for a template variant id. */
export function isTemplateVariant(value: string): value is TemplateVariant {
  return (TEMPLATE_VARIANTS as readonly string[]).includes(value);
}

/** Resolved scaffold options (post-prompt / post-flag). */
export interface ScaffoldOptions {
  /** Target directory name (and default store name slug). */
  projectName: string;
  /** Which template variant to scaffold. */
  variant: TemplateVariant;
  /** Store display name. */
  storeName: string;
  /** Store description (SEO + OG + llms.txt). */
  description: string;
  /** Target cluster. */
  network: StoreNetwork;
  /**
   * The deliberate real-funds mainnet opt-in. NEVER auto-set: pointing a store
   * at real funds must be a conscious second step (`--allow-mainnet` /
   * interactive confirm), not a side effect of choosing `--network mainnet`.
   */
  allowMainnet?: boolean;
  /** Referrer wallet (base58) — the owner earns on every hire. */
  referrerWallet: string;
  /** Referral fee in basis points. */
  referrerFeeBps: number;
  /** Hosted-indexer base URL (or the bare RPC for localnet). */
  apiBaseUrl: string;
  /** Canonical site URL (SEO base). */
  siteUrl: string;
  /** Show the PoweredBy footer (the standing referral disclosure). */
  poweredBy: boolean;
  /** For `provider-storefront`: the single provider agent PDA. */
  providerPda?: string;
  /** For `vertical-store`: the single category token. */
  category?: string;
}

/**
 * A safe single-segment project-name slug: letters, digits, `.`, `_`, `-` only.
 * Rejects path separators, `..`, absolute paths, and the bare `.`/`..` names —
 * so the resolved target directory can NEVER escape the current working
 * directory.
 */
const PROJECT_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

/**
 * Validate a project name BEFORE it is fed to `path.resolve`. `path.resolve`
 * honors `..` and absolute paths, so an unvalidated name like `../../etc/evil`
 * or `/tmp/x` would scaffold OUTSIDE the user's directory (path traversal). A
 * name must be a single safe slug; reject anything with a separator, a `..`
 * segment, an absolute path, or the reserved `.`/`..` names.
 *
 * @param projectName - The raw project name from argv / prompt.
 * @returns `null` if safe, or a human-readable error message.
 */
export function validateProjectName(projectName: string): string | null {
  if (projectName === "." || projectName === "..") {
    return `Invalid project name "${projectName}": reserved name. Use a plain directory name (letters, digits, ".", "_", "-").`;
  }
  if (!PROJECT_NAME_PATTERN.test(projectName)) {
    return (
      `Invalid project name "${projectName}": must be a single directory name ` +
      `(letters, digits, ".", "_", "-" only — no "/", "\\\\", "..", or absolute paths).`
    );
  }
  return null;
}

/** The default indexer/RPC base for a network. */
export function defaultApiBaseUrl(network: StoreNetwork): string {
  switch (network) {
    case "localnet":
      return "http://127.0.0.1:8899";
    case "devnet":
      return "https://api.devnet.solana.com";
    case "mainnet":
      return "https://api.mainnet-beta.solana.com";
  }
}

/**
 * Validate the resolved options by running the same `defineStore` schema the
 * template uses at build time — so a bad referrer wallet / over-cap fee /
 * un-overridden mainnet config is caught BEFORE any files are written. Returns
 * `null` on success or a human-readable error message.
 */
export function validateOptions(opts: ScaffoldOptions): string | null {
  const curation: Record<string, unknown> = { requireModeration: true };
  if (opts.variant === "provider-storefront" && opts.providerPda) {
    curation.providers = [opts.providerPda];
  }
  if (opts.variant === "vertical-store" && opts.category) {
    curation.categories = [opts.category];
  }

  const result = safeDefineStore({
    name: opts.storeName,
    description: opts.description,
    network: opts.network,
    // NEVER auto-set allowMainnet. It is forwarded ONLY when the human made the
    // deliberate real-funds opt-in (--allow-mainnet / interactive confirm); a bare
    // `--network mainnet` leaves it unset, so safeDefineStore's superRefine
    // rejects it here — BEFORE any files are written — exactly as a deployer's
    // build would. This keeps the two-step "never point at real funds by
    // accident" gate intact instead of collapsing it to a one-step choice.
    ...(opts.allowMainnet ? { allowMainnet: true } : {}),
    api: { baseUrl: opts.apiBaseUrl },
    referrer: { wallet: opts.referrerWallet, feeBps: opts.referrerFeeBps },
    branding: { poweredBy: opts.poweredBy },
    curation,
    seo: { siteUrl: opts.siteUrl },
  });

  return result.success ? null : result.error.message;
}
