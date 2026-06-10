/**
 * `StoreConfig` — the single, build-time-validated configuration surface for an
 * AgenC store (PLAN_2 C2). The deployer edits ONE file (`agenc.config.ts`);
 * everything else (curation, branding, SEO, the referral fee) is derived from
 * the validated config. Misconfiguration FAILS THE BUILD with an actionable
 * message — a store never ships silently mis-wired.
 *
 * ## The referrer fee gate (PLAN_2 §0, P6.2)
 *
 * `referrer.wallet` MUST parse as a base58 Solana address (a wrong wallet would
 * silently drop the owner's fees, so it is a hard error) and `referrer.feeBps`
 * is range-checked. The on-chain referrer settlement leg (PLAN.md P6.2) is NOT
 * deployed yet — see {@link REFERRER_COMBINED_FEE_BPS_CAP} and the `feeBps`
 * docs for the combined-cap rule. Validation here is real; injection is gated
 * downstream by `marketplace-react`'s `resolveReferrerCapability()`.
 *
 * @module config/schema
 */
import { isAddress } from "@solana/kit";
import { z } from "zod";

/**
 * The combined on-chain fee cap, in basis points, the P6.2 settlement leg will
 * enforce: `protocol + operator + referrer ≤ 4000 bps` (40%). A store owner's
 * referral fee shares this budget with the protocol fee and the listing's
 * operator fee, so the per-listing combined split is computed at checkout — but
 * a `feeBps` that ALONE already exceeds the whole budget can never be honored,
 * so it is rejected at build time here.
 *
 * @see https://github.com/tetsuo-ai/agenc-protocol PLAN.md P6.2
 */
export const REFERRER_COMBINED_FEE_BPS_CAP = 4000;

/** Minimum referral fee, in basis points (0 = the owner waives the fee). */
export const REFERRER_FEE_BPS_MIN = 0;

/**
 * Maximum referral fee a store config may declare, in basis points. Bounded by
 * {@link REFERRER_COMBINED_FEE_BPS_CAP} because the referrer share alone can
 * never exceed the combined `protocol + operator + referrer` budget. The exact
 * headroom left for the referrer depends on the live protocol + per-listing
 * operator fees and is re-checked per listing at checkout.
 */
export const REFERRER_FEE_BPS_MAX = REFERRER_COMBINED_FEE_BPS_CAP;

/**
 * A Zod refinement that accepts only valid base58 Solana addresses. Reused for
 * the referrer wallet and curation provider/listing addresses so a typo can
 * never silently disable a fee or a curation filter.
 */
const base58Address = z
  .string()
  .refine((value) => isAddress(value), {
    message:
      "must be a valid base58 Solana address (a wrong address would silently " +
      "drop fees or curation filters)",
  });

/**
 * Listing category token. The protocol stores categories as free-form
 * lowercase-kebab strings (e.g. `"code-generation"`, `"data-analysis"`), so the
 * schema validates shape, not a closed enum — new categories appear without an
 * `store-core` release.
 */
export const listingCategorySchema = z
  .string()
  .min(1, "category must not be empty")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'category must be lowercase-kebab (e.g. "code-generation")',
  );

/** {@link listingCategorySchema} as a TypeScript type. */
export type ListingCategory = z.infer<typeof listingCategorySchema>;

/**
 * Referrer config. EVERY hire under this store pays the owner this fee (P6.2;
 * §0 gate). The wallet is validated as base58 and the fee is range-checked +
 * combined-cap-bounded at build time.
 */
export const referrerSchema = z
  .object({
    /**
     * The referrer wallet that earns the fee. MUST be base58 — a wrong wallet
     * would silently drop the owner's fees, so this is a hard build error.
     */
    wallet: base58Address,
    /**
     * Referral fee in basis points (1 bps = 0.01%). Range-checked against
     * `[REFERRER_FEE_BPS_MIN, REFERRER_FEE_BPS_MAX]`. The combined on-chain cap
     * is `protocol + operator + referrer ≤ 4000 bps`
     * ({@link REFERRER_COMBINED_FEE_BPS_CAP}); the per-listing combined split is
     * re-validated at checkout before any transaction is built.
     */
    feeBps: z
      .number()
      .int("feeBps must be an integer number of basis points")
      .min(
        REFERRER_FEE_BPS_MIN,
        `feeBps must be ≥ ${REFERRER_FEE_BPS_MIN}`,
      )
      .max(
        REFERRER_FEE_BPS_MAX,
        `feeBps must be ≤ ${REFERRER_FEE_BPS_MAX} bps — the referrer share alone ` +
          `cannot exceed the combined protocol + operator + referrer cap of ` +
          `${REFERRER_COMBINED_FEE_BPS_CAP} bps (P6.2)`,
      ),
  })
  .strict();

/** {@link referrerSchema} as a TypeScript type. */
export type ReferrerConfig = z.infer<typeof referrerSchema>;

/**
 * Brand colors. All optional — any omitted token falls back to the vendored
 * AgenC `--agenc-*` default. Values are passed through to CSS custom properties
 * verbatim, so any valid CSS color works.
 */
export const brandingColorsSchema = z
  .object({
    /** Primary accent (maps to `--agenc-violet`). */
    primary: z.string().optional(),
    /** Secondary accent (maps to `--agenc-magenta`). */
    secondary: z.string().optional(),
    /** Page background (maps to `--agenc-void`). */
    background: z.string().optional(),
    /** Card/surface background (maps to `--agenc-surface`). */
    surface: z.string().optional(),
    /** Body text (maps to `--agenc-text`). */
    text: z.string().optional(),
  })
  .strict()
  .partial();

/** {@link brandingColorsSchema} as a TypeScript type. */
export type BrandingColors = z.infer<typeof brandingColorsSchema>;

/**
 * Branding surface. `logo`, `colors`, and `font` are white-label overrides; the
 * `poweredBy` footer defaults ON because it doubles as the referral disclosure.
 */
export const brandingSchema = z
  .object({
    /** Logo URL or public-path. Optional — falls back to a text wordmark. */
    logo: z.string().optional(),
    /** Brand color overrides. Any omitted token uses the AgenC default. */
    colors: brandingColorsSchema.optional(),
    /** CSS font-family stack override. Optional. */
    font: z.string().optional(),
    /**
     * Show the "Powered by AgenC" footer. Defaults `true` — it is the standing
     * referral disclosure surface; turning it off does not remove the
     * `/trust`-page disclosure.
     */
    poweredBy: z.boolean().default(true),
  })
  .strict();

/** {@link brandingSchema} as a TypeScript type. */
export type Branding = z.infer<typeof brandingSchema>;

/**
 * Curation rules. All filters are optional and ANDed: a listing is carried only
 * if it passes every supplied filter. `requireModeration` defaults ON
 * (fail-closed) and is the only field that is true by default.
 */
export const curationSchema = z
  .object({
    /** Carry only listings in these categories. Empty/omitted = all. */
    categories: z.array(listingCategorySchema).optional(),
    /** Carry only listings from these provider agent PDAs. */
    providers: z.array(base58Address).optional(),
    /** Listing-level allowlist (by ServiceListing PDA). */
    include: z.array(base58Address).optional(),
    /** Listing-level denylist (by ServiceListing PDA). Wins over `include`. */
    exclude: z.array(base58Address).optional(),
    /**
     * Minimum provider rating once PLAN.md P6.1 `rate_hire` is live. Accepted +
     * stored now; the filter is inert until ratings exist (the store never
     * fabricates a rating).
     */
    minRating: z.number().min(0).max(5).optional(),
    /**
     * Require a CLEAN moderation attestation to render a listing. Defaults
     * `true` (fail-closed). The exact unattested-listing behavior depends on
     * the PLAN.md P6.8 [HUMAN] neutrality decision; until then the default
     * stays ON.
     */
    requireModeration: z.boolean().default(true),
  })
  .strict();

/** {@link curationSchema} as a TypeScript type. */
export type Curation = z.infer<typeof curationSchema>;

/**
 * Payment methods. `wallets` (Wallet Standard) defaults ON. `embedded`, `fiat`,
 * and `x402` are reserved-now flags so adding a payment path later is not a
 * breaking config change. A flag whose backend is not implemented yet FAILS the
 * build (so a store never silently advertises a checkout it can't complete).
 */
export const paymentsSchema = z
  .object({
    /** Wallet Standard connect-and-sign (P4.1). Defaults `true`. */
    wallets: z.boolean().default(true),
    /**
     * Embedded (walletless) buyer wallet. Resolves to the ONE D-1 [HUMAN]-chosen
     * vendor; rejected as unimplemented until that vendor ships.
     */
    embedded: z.boolean().optional(),
    /** Fiat on-ramp (P4.4). Off until the fiat leg exists. */
    fiat: z.boolean().optional(),
    /** x402 fast-path (reserved; off until P5.4 ships). */
    x402: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Reserved-but-unimplemented payment paths must not be enabled — a store
    // that advertises a checkout it cannot complete is a money-safety bug.
    if (value.embedded === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["embedded"],
        message:
          "payments.embedded is reserved: the embedded-wallet vendor (D-1) is " +
          "not wired yet. Remove the flag or set it to false.",
      });
    }
    if (value.fiat === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fiat"],
        message:
          "payments.fiat is reserved: the fiat on-ramp (P4.4) is not " +
          "implemented yet. Remove the flag or set it to false.",
      });
    }
    if (value.x402 === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["x402"],
        message:
          "payments.x402 is reserved: the x402 fast path (P5.4) is not " +
          "implemented yet. Remove the flag or set it to false.",
      });
    }
  });

/** {@link paymentsSchema} as a TypeScript type. */
export type Payments = z.infer<typeof paymentsSchema>;

/**
 * SEO surface. `siteUrl` is required (canonical/OG/sitemap base); the rest
 * default ON so a store is discoverable (by search engines AND agent crawlers)
 * out of the box.
 */
export const seoSchema = z
  .object({
    /** Canonical site origin (e.g. `https://store.example.com`). Required. */
    siteUrl: z
      .string()
      .url("seo.siteUrl must be an absolute URL (canonical/OG/sitemap base)"),
    /** Open Graph image URL. Optional — falls back to the brand logo. */
    ogImage: z.string().optional(),
    /** Emit `/llms.txt` for agent crawlers. Defaults `true`. */
    llmsTxt: z.boolean().default(true),
    /** Emit schema.org JSON-LD (Service/Offer) on listing pages. Defaults `true`. */
    jsonLd: z.boolean().default(true),
    /** Emit `/sitemap.xml`. Defaults `true`. */
    sitemap: z.boolean().default(true),
  })
  .strict();

/** {@link seoSchema} as a TypeScript type. */
export type Seo = z.infer<typeof seoSchema>;

/** Indexer/storefront API connection (PLAN.md P3.2 hosted indexer). */
export const apiSchema = z
  .object({
    /** Base URL of the hosted indexer/storefront API. */
    baseUrl: z
      .string()
      .url("api.baseUrl must be an absolute URL (the P3.2 hosted indexer)"),
    /** Optional API key (`X-Agenc-Api-Key`). Anonymous reads work without it. */
    apiKey: z.string().optional(),
  })
  .strict();

/** {@link apiSchema} as a TypeScript type. */
export type ApiConfig = z.infer<typeof apiSchema>;

/**
 * Target cluster. `"localnet"` is a first-class value for the local-first build
 * strategy (the sandbox stack). `"mainnet"` warns loudly and FAILS validation
 * until Phase 9 unless `allowMainnet: true` is set explicitly
 * ({@link networkSchema}).
 */
export const storeNetworkSchema = z.enum(["localnet", "devnet", "mainnet"]);

/** {@link storeNetworkSchema} as a TypeScript type. */
export type StoreNetwork = z.infer<typeof storeNetworkSchema>;

/**
 * The full store config object schema (pre-cross-field-refinement). The exported
 * {@link storeConfigSchema} adds the mainnet-override cross-check.
 */
export const storeConfigObjectSchema = z
  .object({
    /** Store display name (used in titles, OG, JSON-LD). */
    name: z.string().min(1, "name must not be empty"),
    /** Store description — drives SEO meta, OG, and `/llms.txt`. */
    description: z.string().min(1, "description must not be empty"),
    /** Target cluster. See {@link storeNetworkSchema}. */
    network: storeNetworkSchema,
    /**
     * Explicit mainnet opt-in. `network: "mainnet"` FAILS validation until
     * Phase 9 unless this is `true` — a deliberate, conspicuous override so a
     * store is never pointed at real funds by accident.
     */
    allowMainnet: z.boolean().optional(),
    /** Hosted indexer connection (P3.2). */
    api: apiSchema,
    /** Referrer fee config (P6.2; §0 gate). */
    referrer: referrerSchema,
    /** Branding / white-label surface. */
    branding: brandingSchema.default({ poweredBy: true }),
    /** Curation rules. `requireModeration` defaults ON. */
    curation: curationSchema.default({ requireModeration: true }),
    /** Payment methods. `wallets` defaults ON. */
    payments: paymentsSchema.default({ wallets: true }),
    /** SEO surface. `siteUrl` required; emitters default ON. */
    seo: seoSchema,
  })
  .strict();

/**
 * The full, validated {@link StoreConfig} schema. Adds the cross-field mainnet
 * guard on top of {@link storeConfigObjectSchema}: `network: "mainnet"` without
 * `allowMainnet: true` is a build error (Phase 9 gate).
 */
export const storeConfigSchema = storeConfigObjectSchema.superRefine(
  (value, ctx) => {
    if (value.network === "mainnet" && value.allowMainnet !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["network"],
        message:
          'network: "mainnet" is gated until Phase 9. To deploy a real-funds ' +
          "store deliberately, set `allowMainnet: true` in the config. " +
          'Until then use "localnet" or "devnet".',
      });
    }
  },
);

/**
 * A fully-validated store configuration. This is the OUTPUT type of
 * {@link defineStore} — all defaults are applied and every field is normalized.
 */
export type StoreConfig = z.infer<typeof storeConfigSchema>;

/**
 * The INPUT shape a deployer writes in `agenc.config.ts` (defaults are optional
 * on input, present on output). Use this to type a raw config literal.
 */
export type StoreConfigInput = z.input<typeof storeConfigSchema>;
