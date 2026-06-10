#!/usr/bin/env node
/**
 * `create-agenc-store` CLI (PLAN_2 C4).
 *
 *   npx create-agenc-store my-store
 *   npx create-agenc-store my-store --yes --template vertical-store \
 *       --referrer <wallet> --network localnet
 *
 * Interactive by default; `--yes` (or all-flags-supplied) runs non-interactively
 * so agents can scaffold a store unattended. Validates the config with
 * `store-core` before writing a single file.
 *
 * @module cli
 */
import path from "node:path";
import process from "node:process";
import prompts from "prompts";
import {
  TEMPLATE_VARIANTS,
  isTemplateVariant,
  defaultApiBaseUrl,
  validateOptions,
  validateProjectName,
  type ScaffoldOptions,
  type TemplateVariant,
} from "./config.js";
import { scaffold } from "./scaffold.js";

/** Parsed CLI flags. */
interface Flags {
  projectName?: string;
  yes: boolean;
  template?: string;
  name?: string;
  description?: string;
  network?: string;
  referrer?: string;
  feeBps?: string;
  apiBaseUrl?: string;
  siteUrl?: string;
  provider?: string;
  category?: string;
  noPoweredBy: boolean;
  allowMainnet: boolean;
  help: boolean;
}

/** Parse `argv` into {@link Flags}. */
export function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    yes: false,
    noPoweredBy: false,
    allowMainnet: false,
    help: false,
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === undefined) continue;
    const take = (): string | undefined => rest[++i];
    switch (arg) {
      case "-y":
      case "--yes":
        flags.yes = true;
        break;
      case "--no-powered-by":
        flags.noPoweredBy = true;
        break;
      case "--allow-mainnet":
        flags.allowMainnet = true;
        break;
      case "-h":
      case "--help":
        flags.help = true;
        break;
      case "--template":
      case "-t":
        flags.template = take();
        break;
      case "--name":
        flags.name = take();
        break;
      case "--description":
        flags.description = take();
        break;
      case "--network":
        flags.network = take();
        break;
      case "--referrer":
        flags.referrer = take();
        break;
      case "--fee-bps":
        flags.feeBps = take();
        break;
      case "--api-base-url":
        flags.apiBaseUrl = take();
        break;
      case "--site-url":
        flags.siteUrl = take();
        break;
      case "--provider":
        flags.provider = take();
        break;
      case "--category":
        flags.category = take();
        break;
      default:
        if (!arg.startsWith("-") && flags.projectName === undefined) {
          flags.projectName = arg;
        }
        break;
    }
  }
  return flags;
}

const HELP = `create-agenc-store — scaffold a deploy-your-own AgenC agent store

Usage:
  npx create-agenc-store <project-name> [options]

Options:
  -t, --template <variant>   marketplace-store | provider-storefront | vertical-store
      --name <string>        store display name
      --description <string> store description (SEO/OG/llms.txt)
      --network <cluster>    localnet (default) | devnet | mainnet
      --referrer <base58>    referrer wallet (earns on every hire; P6.2 gated)
      --fee-bps <int>        referral fee in basis points (default 250)
      --api-base-url <url>   hosted indexer base URL (default: per-network RPC)
      --site-url <url>       canonical site URL (default http://localhost:3000)
      --provider <base58>    [provider-storefront] the single provider agent PDA
      --category <token>     [vertical-store] the single category (e.g. code-generation)
      --no-powered-by        hide the PoweredBy footer (also the referral disclosure)
      --allow-mainnet        REQUIRED to scaffold a mainnet store — the deliberate
                             Phase-9 opt-in that points the store at REAL funds
  -y, --yes                  non-interactive; use defaults for anything unspecified
  -h, --help                 show this help

Examples:
  npx create-agenc-store my-store
  npx create-agenc-store code-shop --yes --template vertical-store \\
      --category code-generation --referrer <wallet>
`;

/** Resolve the options, prompting for anything missing unless `--yes`. */
async function resolveOptions(flags: Flags): Promise<ScaffoldOptions | null> {
  const nonInteractive = flags.yes;

  // Project name.
  let projectName = flags.projectName;
  if (!projectName && !nonInteractive) {
    const r = await prompts({
      type: "text",
      name: "projectName",
      message: "Project directory name",
      initial: "my-agenc-store",
    });
    projectName = r.projectName as string | undefined;
  }
  projectName = projectName ?? "my-agenc-store";

  // Reject path-traversal / absolute / multi-segment names BEFORE any path is
  // resolved or any file is written (path.resolve honors `..` and absolute
  // paths, so an unvalidated name could scaffold outside the cwd).
  const nameError = validateProjectName(projectName);
  if (nameError) {
    process.stderr.write(`${nameError}\n`);
    return null;
  }

  // Template variant.
  let variant: TemplateVariant | undefined =
    flags.template && isTemplateVariant(flags.template)
      ? flags.template
      : undefined;
  if (flags.template && !variant) {
    process.stderr.write(
      `Unknown template "${flags.template}". Choose one of: ${TEMPLATE_VARIANTS.join(", ")}\n`,
    );
    return null;
  }
  if (!variant && !nonInteractive) {
    const r = await prompts({
      type: "select",
      name: "variant",
      message: "Template",
      choices: [
        { title: "marketplace-store — full catalog (grid, categories, search)", value: "marketplace-store" },
        { title: "provider-storefront — a single provider's agents", value: "provider-storefront" },
        { title: "vertical-store — one curated category", value: "vertical-store" },
      ],
      initial: 0,
    });
    variant = r.variant as TemplateVariant | undefined;
  }
  variant = variant ?? "marketplace-store";

  // Store name.
  let storeName = flags.name;
  if (!storeName && !nonInteractive) {
    const r = await prompts({
      type: "text",
      name: "storeName",
      message: "Store display name",
      initial: "My Agent Store",
    });
    storeName = r.storeName as string | undefined;
  }
  storeName = storeName ?? "My Agent Store";

  const description =
    flags.description ??
    "Hire vetted AI agents with on-chain escrow on Solana.";

  // Network.
  let network = flags.network;
  if (!network && !nonInteractive) {
    const r = await prompts({
      type: "select",
      name: "network",
      message: "Network",
      choices: [
        { title: "localnet (local sandbox)", value: "localnet" },
        { title: "devnet", value: "devnet" },
        { title: "mainnet (gated until Phase 9)", value: "mainnet" },
      ],
      initial: 0,
    });
    network = r.network as string | undefined;
  }
  network = network ?? "localnet";
  if (network !== "localnet" && network !== "devnet" && network !== "mainnet") {
    process.stderr.write(`Unknown network "${network}".\n`);
    return null;
  }

  // Mainnet points the store at REAL funds and is Phase-9-gated. Choosing the
  // network is NOT enough — the deployer must make a deliberate second opt-in.
  // We NEVER auto-set allowMainnet (that silently collapses the two-step money
  // gate); require an explicit --allow-mainnet flag or an interactive confirm,
  // and otherwise refuse before any filesystem work.
  let allowMainnet = false;
  if (network === "mainnet") {
    if (flags.allowMainnet) {
      allowMainnet = true;
    } else if (!nonInteractive) {
      const r = await prompts({
        type: "confirm",
        name: "allowMainnet",
        message:
          "mainnet points this store at REAL funds (Phase-9 gated). Opt in?",
        initial: false,
      });
      allowMainnet = r.allowMainnet === true;
    }
    if (!allowMainnet) {
      process.stderr.write(
        "Refusing to scaffold a mainnet store without an explicit opt-in.\n" +
          "mainnet is Phase-9-gated and points at REAL funds. Re-run with " +
          "--allow-mainnet (or confirm interactively) to deliberately opt in, " +
          "or hand-add `allowMainnet: true` to the generated agenc.config.ts " +
          "yourself.\n",
      );
      return null;
    }
  }

  // Referrer wallet.
  let referrerWallet = flags.referrer;
  if (!referrerWallet && !nonInteractive) {
    const r = await prompts({
      type: "text",
      name: "referrer",
      message: "Referrer wallet (you earn on every hire; base58)",
    });
    referrerWallet = r.referrer as string | undefined;
  }
  if (!referrerWallet) {
    process.stderr.write(
      "A referrer wallet is required (the store owner who earns the fee). " +
        "Pass --referrer <base58> or run interactively.\n",
    );
    return null;
  }

  const feeBps = flags.feeBps ? Number(flags.feeBps) : 250;
  const apiBaseUrl =
    flags.apiBaseUrl ?? defaultApiBaseUrl(network as ScaffoldOptions["network"]);
  const siteUrl = flags.siteUrl ?? "http://localhost:3000";

  // Variant-specific.
  let providerPda = flags.provider;
  if (variant === "provider-storefront" && !providerPda && !nonInteractive) {
    const r = await prompts({
      type: "text",
      name: "provider",
      message: "Provider agent PDA (the single provider this storefront shows)",
    });
    providerPda = r.provider as string | undefined;
  }
  // Default to the referrer wallet only as a placeholder when none supplied.
  if (variant === "provider-storefront" && !providerPda) {
    providerPda = referrerWallet;
  }

  let category = flags.category;
  if (variant === "vertical-store" && !category && !nonInteractive) {
    const r = await prompts({
      type: "text",
      name: "category",
      message: "Category token (lowercase-kebab, e.g. code-generation)",
      initial: "code-generation",
    });
    category = r.category as string | undefined;
  }
  if (variant === "vertical-store" && !category) {
    category = "code-generation";
  }

  return {
    projectName,
    variant,
    storeName,
    description,
    network: network as ScaffoldOptions["network"],
    allowMainnet,
    referrerWallet,
    referrerFeeBps: feeBps,
    apiBaseUrl,
    siteUrl,
    poweredBy: !flags.noPoweredBy,
    ...(providerPda ? { providerPda } : {}),
    ...(category ? { category } : {}),
  };
}

/** CLI entrypoint. */
export async function main(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  if (flags.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const opts = await resolveOptions(flags);
  if (!opts) return 1;

  // Validate with store-core's schema BEFORE writing any files.
  const error = validateOptions(opts);
  if (error) {
    process.stderr.write(`\nInvalid store configuration:\n${error}\n`);
    return 1;
  }

  const targetDir = path.resolve(process.cwd(), opts.projectName);
  try {
    const written = await scaffold(opts, targetDir);
    process.stdout.write(
      `\n✓ Scaffolded ${opts.variant} into ${opts.projectName}/\n` +
        `  Filled: ${written.join(", ")}\n\n` +
        "Next steps:\n" +
        `  cd ${opts.projectName}\n` +
        "  npm install\n" +
        (opts.network === "localnet"
          ? "  # boot the local sandbox in your agenc-store-templates checkout first:\n" +
            "  #   npm run sandbox:up\n"
          : "") +
        "  npm run dev\n\n" +
        "Edit agenc.config.ts to customize. The referral fee is validated + " +
        "disclosed but not injected until protocol P6.2 ships.\n",
    );
    return 0;
  } catch (err) {
    process.stderr.write(`\nScaffold failed: ${(err as Error).message}\n`);
    return 1;
  }
}

// Run when invoked as a binary (not when imported by a test).
if (
  process.argv[1] &&
  path.resolve(process.argv[1]).includes("create-agenc-store")
) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${err?.stack ?? err}\n`);
      process.exit(1);
    },
  );
}
