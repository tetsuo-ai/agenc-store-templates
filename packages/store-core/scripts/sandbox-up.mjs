#!/usr/bin/env node
/**
 * sandbox-up.mjs — the committed deterministic local-validator bootstrap for
 * the AgenC store templates' CI (PLAN_2 C3 Done-when: "template CI runs against
 * a deterministic local validator").
 *
 * It REUSES the same strategy as
 * `<agenc-protocol>/packages/marketplace-react/test/sandbox-up.mjs`: it does NOT
 * re-implement boot/init/seed. It drives the canonical `agenc-protocol` localnet
 * stack so a template e2e runs against EXACTLY the same on-chain state the
 * protocol + SDK + marketplace-react are tested against:
 *
 *   1. <agenc-protocol>/scripts/localnet-up.mjs
 *        boots solana-test-validator with the REAL program id genesis-loaded as
 *        an UPGRADEABLE program, runs the real initialize_protocol +
 *        configure_task_moderation, and writes <agenc-protocol>/.localnet/env.json.
 *   2. <agenc-protocol>/packages/sdk-ts/scripts/seed-devnet-sandbox.mjs
 *        registers the sandbox provider agents, creates one Active ServiceListing
 *        each, attests every listing CLEAN, and writes fixtures.json.
 *
 * ## Why cross-repo
 *
 * `agenc-store-templates` is a SEPARATE repo from `agenc-protocol`; it cannot
 * workspace-link, and the prebuilt program `.so` + the canonical localnet stack
 * live in `agenc-protocol`. The pinned `@tetsuo-ai/marketplace-sdk` tarball this
 * repo installs DOES ship the program `.so` (at `testing-assets/`) and a
 * `./sandbox` fixtures surface — but booting an UPGRADEABLE program with a real
 * ProgramData PDA + the protocol/moderation initializers is exactly what the
 * agenc-protocol stack already does correctly. So this script locates that stack
 * and delegates, rather than re-deriving the boot choreography here.
 *
 * Resolve the agenc-protocol checkout via (first hit wins):
 *   1. AGENC_PROTOCOL_DIR env var (an explicit path to the checkout),
 *   2. the workspace sibling ../../agenc-protocol (the default layout),
 *   3. a `node_modules/@tetsuo-ai/marketplace-sdk` resolution hint (reports the
 *      tarball's bundled `.so` location so an operator can wire a checkout).
 *
 * Programmatic API (consumed by template global-setup):
 *   import { start, stop, readSandboxEnv } from "./sandbox-up.mjs";
 *   const env = await start();   // { rpcUrl, rpcSubscriptionsUrl, programId,
 *                                //   envFile, fixturesPath, fixtures, keypairs }
 *   await stop();
 *
 * CLI:
 *   node scripts/sandbox-up.mjs up        # boot + init + seed (idempotent)
 *   node scripts/sandbox-up.mjs down      # stop the validator
 *   node scripts/sandbox-up.mjs down --purge
 *   node scripts/sandbox-up.mjs env       # print the resolved sandbox env JSON
 *
 * Idempotent: re-running `up` converges. `stop()` is safe when nothing runs.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// scripts/ -> store-core -> packages -> <agenc-store-templates root>
const STORE_TEMPLATES_ROOT = path.resolve(HERE, "../../..");

/** Default RPC port for the sandbox validator (websocket is always port+1). */
export const SANDBOX_PORT = 8899;

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the agenc-protocol checkout that owns the canonical localnet stack.
 * @returns {Promise<string>} absolute path to the agenc-protocol checkout.
 * @throws when no checkout can be located (with an actionable message).
 */
export async function resolveProtocolDir() {
  const candidates = [];
  if (process.env.AGENC_PROTOCOL_DIR) {
    candidates.push(path.resolve(process.env.AGENC_PROTOCOL_DIR));
  }
  // The default workspace sibling layout: <workspace>/agenc-store-templates and
  // <workspace>/agenc-protocol live side by side.
  candidates.push(path.resolve(STORE_TEMPLATES_ROOT, "../agenc-protocol"));

  for (const dir of candidates) {
    if (await fileExists(path.join(dir, "scripts/localnet-up.mjs"))) {
      return dir;
    }
  }

  // Last resort: report the tarball's bundled .so so an operator knows the
  // program binary IS available even when the protocol checkout is not.
  let soHint = "";
  try {
    const require = createRequire(import.meta.url);
    const sdkPkg = require.resolve("@tetsuo-ai/marketplace-sdk/package.json");
    const sdkDir = path.dirname(sdkPkg);
    const so = path.join(sdkDir, "testing-assets/agenc_coordination.so");
    if (await fileExists(so)) {
      soHint = `\n  (the SDK tarball ships the program .so at ${so}, but booting an ` +
        "upgradeable program + the protocol/moderation initializers requires the " +
        "agenc-protocol localnet stack.)";
    }
  } catch {
    /* ignore — best-effort hint only */
  }

  throw new Error(
    "Could not locate the agenc-protocol checkout that owns the localnet stack.\n" +
      "  Set AGENC_PROTOCOL_DIR to your agenc-protocol checkout, or place it as a " +
      "workspace sibling at ../agenc-protocol." +
      soHint,
  );
}

function localnetEnvFile(protocolDir) {
  return path.join(protocolDir, ".localnet/env.json");
}

/**
 * Run a node script as a child process (stdio inherited so boot/seed progress
 * is visible). Rejects on a non-zero exit.
 */
function runNode(scriptPath, args, cwd, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: quiet ? ["ignore", "ignore", "inherit"] : "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`${path.basename(scriptPath)} exited with code ${code}`),
        );
    });
  });
}

/** Read + parse the localnet env file written by localnet-up.mjs. */
export async function readLocalnetEnv(envFile) {
  try {
    return JSON.parse(await readFile(envFile, "utf8"));
  } catch {
    return null;
  }
}

/** Read + parse the seeded fixtures file. */
export async function readSandboxFixtures(fixturesPath) {
  if (!fixturesPath) return null;
  try {
    return JSON.parse(await readFile(fixturesPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Resolve the full sandbox environment (env file + fixtures) WITHOUT booting.
 * Returns null when the stack has never been brought up.
 */
export async function readSandboxEnv(protocolDir) {
  const dir = protocolDir ?? (await resolveProtocolDir());
  const envFile = localnetEnvFile(dir);
  const env = await readLocalnetEnv(envFile);
  if (env === null) return null;
  const fixtures = await readSandboxFixtures(env.fixturesPath);
  return {
    cluster: env.cluster,
    rpcUrl: env.rpcUrl,
    rpcSubscriptionsUrl: env.rpcSubscriptionsUrl,
    programId: env.programId,
    envFile,
    fixturesPath: env.fixturesPath ?? null,
    fixtures,
    keypairs: env.keypairs ?? null,
  };
}

/**
 * Boot the deterministic local sandbox via the agenc-protocol stack, then seed
 * the listings (attested CLEAN). Idempotent.
 *
 * @param {object} [options]
 * @param {number} [options.port=8899]
 * @param {boolean} [options.keepLedger=false]
 * @param {boolean} [options.seed=true]
 * @param {boolean} [options.quiet=false]
 * @returns {Promise<object>} the resolved sandbox env (see readSandboxEnv).
 */
export async function start(options = {}) {
  const {
    port = SANDBOX_PORT,
    keepLedger = false,
    seed = true,
    quiet = false,
  } = options;

  const protocolDir = await resolveProtocolDir();
  await assertPrereqs(protocolDir);

  const localnetUp = path.join(protocolDir, "scripts/localnet-up.mjs");
  const seedScript = path.join(
    protocolDir,
    "packages/sdk-ts/scripts/seed-devnet-sandbox.mjs",
  );
  const envFile = localnetEnvFile(protocolDir);

  // 1) Boot + initialize protocol/moderation config + write env.json.
  const upArgs = ["--port", String(port)];
  if (keepLedger) upArgs.push("--keep-ledger");
  await runNode(localnetUp, upArgs, protocolDir, { quiet });

  const env = await readLocalnetEnv(envFile);
  if (env === null) {
    throw new Error(`localnet-up.mjs did not write ${envFile} — boot likely failed`);
  }

  // 2) Seed providers + Active listings, attested CLEAN.
  if (seed) {
    await runNode(seedScript, ["--env-file", envFile], protocolDir, { quiet });
  }

  const resolved = await readSandboxEnv(protocolDir);
  if (resolved === null) {
    throw new Error(`could not resolve sandbox env from ${envFile} after start`);
  }
  if (seed && (resolved.fixtures === null || !resolved.fixtures.seeded)) {
    throw new Error(
      `seed step did not produce seeded fixtures at ${resolved.fixturesPath}`,
    );
  }
  return resolved;
}

/**
 * Stop the sandbox validator (localnet-down.mjs). Safe when nothing runs.
 * @param {object} [options]
 * @param {boolean} [options.purge=false]
 * @param {boolean} [options.quiet=false]
 */
export async function stop(options = {}) {
  const protocolDir = await resolveProtocolDir();
  const localnetDown = path.join(protocolDir, "scripts/localnet-down.mjs");
  const args = options.purge ? ["--purge"] : [];
  await runNode(localnetDown, args, protocolDir, { quiet: options.quiet });
}

/** Fail fast with an actionable message if a prerequisite is missing. */
async function assertPrereqs(protocolDir) {
  const localnetUp = path.join(protocolDir, "scripts/localnet-up.mjs");
  const seedScript = path.join(
    protocolDir,
    "packages/sdk-ts/scripts/seed-devnet-sandbox.mjs",
  );
  const so = path.join(
    protocolDir,
    "programs/agenc-coordination/target/deploy/agenc_coordination.so",
  );
  const sdkDist = path.join(protocolDir, "packages/sdk-ts/dist/index.js");
  if (!(await fileExists(localnetUp))) {
    throw new Error(`missing ${localnetUp} (agenc-protocol layout changed?)`);
  }
  if (!(await fileExists(seedScript))) {
    throw new Error(`missing ${seedScript} (agenc-protocol layout changed?)`);
  }
  if (!(await fileExists(so))) {
    throw new Error(
      `program binary missing: ${so}\n  Run \`anchor build\` in agenc-protocol first.`,
    );
  }
  if (!(await fileExists(sdkDist))) {
    throw new Error(
      `built SDK missing: ${sdkDist}\n  Run \`cd packages/sdk-ts && npm install && npm run build\` in agenc-protocol first.`,
    );
  }
}

// ---------------------------------------------------------------------- CLI
async function cli() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "up":
    case undefined: {
      const keepLedger = rest.includes("--keep-ledger");
      const noSeed = rest.includes("--no-seed");
      const env = await start({ keepLedger, seed: !noSeed });
      console.log("\nsandbox-up: ready.");
      console.log(`  rpc:       ${env.rpcUrl}`);
      console.log(`  ws:        ${env.rpcSubscriptionsUrl}`);
      console.log(`  program:   ${env.programId}`);
      console.log(`  env file:  ${env.envFile}`);
      console.log(`  fixtures:  ${env.fixturesPath ?? "(not seeded)"}`);
      if (env.fixtures) {
        console.log(`  listings:  ${env.fixtures.listings.length} seeded`);
      }
      break;
    }
    case "down": {
      const purge = rest.includes("--purge");
      await stop({ purge });
      break;
    }
    case "env": {
      const env = await readSandboxEnv();
      console.log(JSON.stringify(env, null, 2));
      break;
    }
    default:
      console.error(
        `sandbox-up: unknown command "${cmd}". Use: up | down [--purge] | env`,
      );
      process.exit(1);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  cli().catch((error) => {
    console.error(`\nsandbox-up: ERROR: ${error?.stack ?? error}`);
    process.exit(1);
  });
}
