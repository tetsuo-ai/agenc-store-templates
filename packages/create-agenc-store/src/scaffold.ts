/**
 * The scaffolder (PLAN_2 C4): copy the chosen template into the target dir, then
 * overwrite the generated files (`agenc.config.ts`, `.env.example`) and the
 * package name. The template's page code is copied verbatim — all the
 * customization is config (the C1 rule).
 *
 * @module scaffold
 */
import {
  cp,
  mkdir,
  readFile,
  writeFile,
  stat,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ScaffoldOptions, TemplateVariant } from "./config.js";
import { renderAgencConfig, renderEnvExample } from "./render.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Names never copied from a template source tree into a scaffold. */
const SKIP_ENTRIES = new Set([
  "node_modules",
  ".next",
  "next-env.d.ts",
  ".turbo",
  "dist",
  "out",
  "coverage",
]);

function isBuildArtifact(name: string): boolean {
  return SKIP_ENTRIES.has(name) || name.endsWith(".tsbuildinfo");
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the directory holding the template variants. Two layouts:
 * 1. PUBLISHED: `<pkg>/templates/<variant>` (bundled into the npm tarball).
 * 2. MONOREPO dev: `<repo>/templates/<variant>` (three dirs up from `dist/`).
 *
 * @param variant - The variant to locate.
 * @returns Absolute path to the variant's template source.
 * @throws when no template source can be found.
 */
export async function resolveTemplateDir(
  variant: TemplateVariant,
): Promise<string> {
  const candidates = [
    // Published: bundled alongside dist/.
    path.resolve(HERE, "../templates", variant),
    // Dev (running from dist/): packages/create-agenc-store/dist -> repo root.
    path.resolve(HERE, "../../../templates", variant),
    // Dev (running from src/ via tsx): packages/create-agenc-store/src -> repo.
    path.resolve(HERE, "../../../../templates", variant),
  ];
  for (const dir of candidates) {
    if (await exists(path.join(dir, "package.json"))) return dir;
  }
  throw new Error(
    `Could not locate the "${variant}" template source. Looked in:\n` +
      candidates.map((c) => `  - ${c}`).join("\n"),
  );
}

/** Recursively copy a template tree, skipping build/dep artifacts. */
async function copyTemplate(srcDir: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (isBuildArtifact(entry.name)) continue;
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyTemplate(from, to);
    } else {
      await cp(from, to);
    }
  }
}

/** Set the scaffolded app's package.json `name` to the project name. */
async function rewritePackageName(
  destDir: string,
  projectName: string,
): Promise<void> {
  const pkgPath = path.join(destDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<
    string,
    unknown
  >;
  pkg.name = projectName;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

/** Rename `gitignore` template files to `.gitignore` if present (npm pack quirk). */
async function normalizeGitignore(destDir: string): Promise<void> {
  const renamed = path.join(destDir, "gitignore");
  if (await exists(renamed)) {
    await cp(renamed, path.join(destDir, ".gitignore"));
  }
}

/**
 * Scaffold a new AgenC store into `targetDir` from the chosen template.
 *
 * @param opts - The validated scaffold options.
 * @param targetDir - Absolute path to create the store in.
 * @returns The list of generated/overwritten files (relative to targetDir).
 */
export async function scaffold(
  opts: ScaffoldOptions,
  targetDir: string,
): Promise<string[]> {
  if (await exists(targetDir)) {
    const contents = await readdir(targetDir);
    if (contents.length > 0) {
      throw new Error(
        `Target directory is not empty: ${targetDir}\n` +
          "Choose a new directory name or remove the existing one.",
      );
    }
  }

  const templateDir = await resolveTemplateDir(opts.variant);
  await copyTemplate(templateDir, targetDir);
  await normalizeGitignore(targetDir);
  await rewritePackageName(targetDir, opts.projectName);

  // Overwrite the generated config + env with the deployer's values.
  const configPath = path.join(targetDir, "agenc.config.ts");
  await writeFile(configPath, renderAgencConfig(opts));
  await writeFile(
    path.join(targetDir, ".env.example"),
    renderEnvExample(),
  );

  return ["agenc.config.ts", ".env.example", "package.json"];
}
