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
    "manifest/index": "src/manifest/index.ts",
    "seo/index": "src/seo/index.ts",
    "sections/index": "src/sections/index.ts",
    "upgrade/index": "src/upgrade/index.ts",
    "activation/index": "src/activation/index.ts",
    "activation/server": "src/activation/server.ts",
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
    // NEVER bundle react-query: a bundled copy carries its own React context,
    // so `useChangelogFeed`'s `useQuery` cannot see the QueryClient that
    // marketplace-react's AgencProvider provides — "No QueryClient set", and
    // every page of every scaffolded store 500'd on SSR (cross-node canary
    // finding #1, 2026-07-02). Declared in `dependencies` with the same range
    // as marketplace-react so npm dedupes to ONE instance.
    "@tanstack/react-query",
  ],
});
