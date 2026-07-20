#!/usr/bin/env node
/**
 * Bundle the three template variants INTO this package's `templates/` dir so the
 * published npm tarball ships them (PLAN_2 C4). At runtime `resolveTemplateDir`
 * checks `<pkg>/templates/<variant>` first.
 *
 * Run as a `prepack` step. In the monorepo, `resolveTemplateDir` also falls back
 * to the repo-root `templates/`, so this is only needed for the published
 * tarball — it is safe to run anytime (idempotent copy).
 *
 * Each template's `.gitignore` is copied as `gitignore` (no leading dot) because
 * npm pack EXCLUDES dotfiles named `.gitignore` from a published tarball; the
 * CLI's scaffolder (`normalizeGitignore`) renames it back to `.gitignore` in the
 * generated store.
 */
import { cp, mkdir, rm, readdir, stat, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, "..");
const REPO_TEMPLATES = path.resolve(PKG_DIR, "../../templates");
const DEST_TEMPLATES = path.join(PKG_DIR, "templates");

const VARIANTS = ["marketplace-store", "provider-storefront", "vertical-store"];
const SKIP = new Set([
  "node_modules",
  ".next",
  "next-env.d.ts",
  "dist",
  "out",
  ".turbo",
  "coverage",
]);

function isBuildArtifact(name) {
  return SKIP.has(name) || name.endsWith(".tsbuildinfo");
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyTree(src, dest) {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (isBuildArtifact(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else await cp(from, to);
  }
}

async function main() {
  await rm(DEST_TEMPLATES, { recursive: true, force: true });
  for (const variant of VARIANTS) {
    const src = path.join(REPO_TEMPLATES, variant);
    if (!(await exists(path.join(src, "package.json")))) {
      throw new Error(`template source missing: ${src}`);
    }
    const dest = path.join(DEST_TEMPLATES, variant);
    await copyTree(src, dest);
    // Rename .gitignore -> gitignore so npm pack ships it.
    const dot = path.join(dest, ".gitignore");
    if (await exists(dot)) await rename(dot, path.join(dest, "gitignore"));
    console.log(`bundled ${variant}`);
  }
  console.log(`templates bundled into ${DEST_TEMPLATES}`);
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
