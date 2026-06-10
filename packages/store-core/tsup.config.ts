import { defineConfig } from "tsup";

/**
 * Build the four public entrypoints of `@tetsuo-ai/store-core` as ESM (+ a CJS
 * root for tooling that still requires CommonJS) with `.d.ts` types.
 *
 * `react`, the SDK, and `marketplace-react` are peers — never bundled. `zod` is
 * a real dependency and is bundled-by-reference (left external; resolved from
 * the consumer's node_modules).
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "config/index": "src/config/index.ts",
    "seo/index": "src/seo/index.ts",
    "sections/index": "src/sections/index.ts",
    "upgrade/index": "src/upgrade/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@tetsuo-ai/marketplace-react",
    "@tetsuo-ai/marketplace-sdk",
    "@solana/kit",
    "@solana/program-client-core",
    "zod",
  ],
});
