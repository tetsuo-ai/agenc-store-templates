#!/usr/bin/env node
/**
 * check-pins — WP-D3 support-matrix guard for @tetsuo-ai/* pins.
 *
 * Asserts that every `@tetsuo-ai/marketplace-*` / `@tetsuo-ai/store-core` pin in
 * this repo's SOURCE package.json files (repo root, packages/*, templates/*)
 * resolves — at its MINIMUM resolvable version — inside the published support
 * matrix for the live mainnet program wire. Old majors/minors fail CLOSED on
 * mainnet (Borsh/account-shape rejects), so a template that scaffolds an
 * out-of-matrix pin ships a dead store (the 2026-06-11 sdk 0.3.0 failure mode).
 *
 * Source of truth for the matrix: agenc-protocol `docs/VERSIONING.md` §1.1.
 * CI is intentionally disabled in this repo (cost) — this script is part of the
 * PRE-RELEASE gate: run `npm run check:pins` before any lockstep republish or
 * template publish, and update SUPPORT_MATRIX below IN THE SAME COMMIT as any
 * lockstep pin bump.
 *
 * Note: `packages/create-agenc-store/templates/` (the bundled scaffold copy) is
 * GENERATED from the repo-root `templates/` by `bundle-templates.mjs` at prepack
 * and is gitignored — the root `templates/` files checked here are the source of
 * those scaffold-output pins.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// SUPPORT MATRIX — as of 2026-07-03 (P1.2 hardened open roster, 90-ix surface,
// 9/14/13 moderation gates). Keep in lockstep with agenc-protocol
// docs/VERSIONING.md §1.1. Update this constant ALONGSIDE any lockstep
// republish + pin bump.
// ---------------------------------------------------------------------------
const SUPPORT_MATRIX = {
  "@tetsuo-ai/marketplace-sdk": { min: "0.8.0", maxExclusive: "0.9.0" },
  "@tetsuo-ai/marketplace-react": { min: "0.4.0", maxExclusive: "0.5.0" },
  "@tetsuo-ai/marketplace-tools": { min: "0.4.0", maxExclusive: "0.5.0" },
  "@tetsuo-ai/marketplace-mcp": { min: "0.4.0", maxExclusive: "0.5.0" },
  "@tetsuo-ai/marketplace-moderation": { min: "0.1.0", maxExclusive: "0.2.0" },
  // 0.6.0 (roster-trust rail) is ADDITIVE on the same program wire as 0.5.x —
  // both minors stay in-matrix until a wire change retires 0.5.x.
  "@tetsuo-ai/store-core": { min: "0.5.0", maxExclusive: "0.7.0" },
};

const DEP_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/** Parse "x.y.z" (or "x.y" / "x") into a comparable triple, else null. */
function parseVersion(v) {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Minimum resolvable version of a range. Handles the shapes this repo uses:
 * exact ("0.8.1"), caret ("^0.8.0"), tilde ("~0.8.0"), ">=0.8.0 <0.9.0",
 * "0.8.x". Anything unpinnable ("*", "latest", "workspace:", "file:", tags)
 * returns null and is reported as a failure — templates must ship a concrete
 * in-matrix floor.
 */
function minResolvable(range) {
  const r = range.trim();
  if (r === "" || r === "*" || r === "latest" || /^(workspace|file|link|npm|git):/.test(r)) {
    return null;
  }
  // First version-looking token wins: for ^/~/exact/>= it IS the range floor.
  const m = /(\d+)\.(\d+|x|\*)(?:\.(\d+|x|\*))?/.exec(r);
  if (!m) return null;
  return [Number(m[1]), m[2] === "x" || m[2] === "*" ? 0 : Number(m[2]), !m[3] || m[3] === "x" || m[3] === "*" ? 0 : Number(m[3])];
}

async function collectManifests() {
  const files = [path.join(REPO_ROOT, "package.json")];
  for (const dir of ["packages", "templates"]) {
    const base = path.join(REPO_ROOT, dir);
    let entries;
    try {
      entries = await readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === "node_modules") continue;
      files.push(path.join(base, e.name, "package.json"));
    }
  }
  return files;
}

const failures = [];
let checked = 0;

for (const file of await collectManifests()) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") continue;
    failures.push(`${file}: unreadable/invalid JSON (${err.message})`);
    continue;
  }
  const rel = path.relative(REPO_ROOT, file);
  for (const section of DEP_SECTIONS) {
    for (const [name, range] of Object.entries(pkg[section] ?? {})) {
      if (!(name.startsWith("@tetsuo-ai/marketplace-") || name === "@tetsuo-ai/store-core")) {
        continue;
      }
      checked++;
      const matrix = SUPPORT_MATRIX[name];
      if (!matrix) {
        failures.push(
          `${rel} [${section}] ${name}@"${range}": package is not in SUPPORT_MATRIX — add its supported range to scripts/check-pins.mjs.`,
        );
        continue;
      }
      const min = minResolvable(range);
      if (!min) {
        failures.push(
          `${rel} [${section}] ${name}@"${range}": range has no concrete resolvable floor — pin a version inside >=${matrix.min} <${matrix.maxExclusive}.`,
        );
        continue;
      }
      const floor = parseVersion(matrix.min);
      const ceil = parseVersion(matrix.maxExclusive);
      if (cmp(min, floor) < 0 || cmp(min, ceil) >= 0) {
        failures.push(
          `${rel} [${section}] ${name}@"${range}": minimum resolvable version ${min.join(".")} is OUTSIDE the support matrix (>=${matrix.min} <${matrix.maxExclusive}). ` +
            `Old ranges fail CLOSED against the live mainnet program wire.`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`check:pins FAILED — ${failures.length} pin(s) outside the support matrix:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(
    `\nFix: bump the pin(s) into the supported range, OR — if a lockstep republish just` +
      `\nmoved the compatible set — update the SUPPORT_MATRIX constant at the top of` +
      `\nscripts/check-pins.mjs in the same commit as the pin bump, keeping it in sync` +
      `\nwith agenc-protocol docs/VERSIONING.md §1.1.`,
  );
  process.exit(1);
}

if (checked === 0) {
  console.error("check:pins FAILED — found no @tetsuo-ai/marketplace-*/store-core pins at all (scan broken?).");
  process.exit(1);
}

console.log(`check:pins OK — ${checked} @tetsuo-ai pin(s) inside the support matrix (sdk >=0.8 <0.9, react/tools/mcp >=0.4 <0.5, store-core >=0.5 <0.7).`);
