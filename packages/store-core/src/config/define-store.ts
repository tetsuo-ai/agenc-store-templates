/**
 * `defineStore(config)` — the build-time entrypoint a store's `agenc.config.ts`
 * calls. It validates the raw config against {@link storeConfigSchema} and, on
 * failure, throws a {@link StoreConfigError} whose message lists EVERY problem
 * with its field path and an actionable hint — so a misconfig fails the build
 * with a message a deployer can act on (PLAN_2 C2).
 *
 * @module config/define-store
 */
import { z } from "zod";
import {
  storeConfigSchema,
  type StoreConfig,
  type StoreConfigInput,
} from "./schema.js";

/**
 * Thrown by {@link defineStore} when the config fails validation. The `message`
 * is a multi-line, human-readable list of every issue; `issues` is the raw Zod
 * issue array for programmatic use (tests, tooling).
 */
export class StoreConfigError extends Error {
  /** The raw Zod issues that caused the failure. */
  readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[]) {
    super(StoreConfigError.format(issues));
    this.name = "StoreConfigError";
    this.issues = issues;
  }

  /** Render the issue list as an actionable, multi-line build error. */
  static format(issues: z.ZodIssue[]): string {
    const lines = issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  • ${path}: ${issue.message}`;
    });
    return [
      "Invalid AgenC store config (agenc.config.ts). Fix the following and rebuild:",
      ...lines,
    ].join("\n");
  }
}

/**
 * Validate + normalize a raw store config into a fully-defaulted
 * {@link StoreConfig}.
 *
 * Call this from `agenc.config.ts`:
 * ```ts
 * import { defineStore } from "@tetsuo-ai/store-core";
 *
 * export default defineStore({
 *   name: "Acme Agent Store",
 *   description: "Hire vetted agents for code review.",
 *   network: "devnet",
 *   api: { baseUrl: "https://indexer.example.com" },
 *   referrer: { wallet: "<base58>", feeBps: 250 },
 *   branding: { poweredBy: true },
 *   seo: { siteUrl: "https://store.example.com" },
 * });
 * ```
 *
 * @param config - The raw config (defaults optional; see {@link StoreConfigInput}).
 * @returns The validated, fully-defaulted {@link StoreConfig}.
 * @throws {StoreConfigError} when validation fails — the message lists every
 *   problem with its field path and an actionable hint.
 */
export function defineStore(config: StoreConfigInput): StoreConfig {
  const result = storeConfigSchema.safeParse(config);
  if (!result.success) {
    throw new StoreConfigError(result.error.issues);
  }
  return result.data;
}

/**
 * Non-throwing variant of {@link defineStore} for tooling/tests that want to
 * inspect the issues without a try/catch.
 *
 * @param config - The raw config.
 * @returns A discriminated result: `{ success: true, config }` or
 *   `{ success: false, error }`.
 */
export function safeDefineStore(
  config: unknown,
):
  | { success: true; config: StoreConfig }
  | { success: false; error: StoreConfigError } {
  const result = storeConfigSchema.safeParse(config);
  if (result.success) {
    return { success: true, config: result.data };
  }
  return { success: false, error: new StoreConfigError(result.error.issues) };
}
