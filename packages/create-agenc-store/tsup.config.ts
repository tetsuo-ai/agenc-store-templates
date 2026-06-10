import { defineConfig } from "tsup";

/**
 * Build the create-agenc-store CLI. ESM-only (it ships a Node bin), bundling the
 * small `prompts` helper graph is left external (declared dependency). The
 * templates themselves are NOT bundled by tsup — they are shipped as static
 * files via the package.json `files` list and resolved at runtime.
 */
export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: false,
  sourcemap: true,
  shims: true,
  // No `banner` shebang: the `src/cli.ts` source already starts with one and
  // tsup preserves it (a banner would duplicate it and break `node dist/cli.js`).
});
