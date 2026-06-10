/**
 * Loads the validated store config + derives the shared contexts the pages
 * consume. This is the ONLY place a page touches `agenc.config.ts`; every page
 * imports `storeConfig` / `seoContext` from here.
 *
 * `defineStore` already ran at import time of `agenc.config.ts` and threw a
 * `StoreConfigError` (failing the build) on any misconfiguration — so by the
 * time this module loads, `storeConfig` is fully validated + defaulted.
 */
import storeConfig from "../../agenc.config";
import { storeSeoContext } from "@tetsuo-ai/store-core/seo";

export { storeConfig };

/** The SEO context every emitter (JSON-LD, meta, sitemap, llms.txt) consumes. */
export const seoContext = storeSeoContext({
  name: storeConfig.name,
  description: storeConfig.description,
  seo: storeConfig.seo,
  branding: { logo: storeConfig.branding.logo },
});

/** The credible-exit / trust links surfaced on `/trust`. */
export const TRUST_HREF = "/trust";
