/**
 * create-agenc-store smoke test (PLAN_2 C4 Done-when). Scaffolds each variant
 * into a temp dir and asserts the generated tree is complete + the generated
 * `agenc.config.ts` validates against the store-core schema. The heavier
 * "scaffold → npm install → next build against the sandbox" round-trip is run in
 * CI (and was verified manually); a full browser run is browser-gated.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseFlags } from "../src/cli.js";
import {
  validateOptions,
  validateProjectName,
  type ScaffoldOptions,
} from "../src/config.js";
import { renderAgencConfig } from "../src/render.js";
import { scaffold } from "../src/scaffold.js";

const TEST_REFERRER = "8iC21EoERDWSXRc5AH8fQBaV32pMSsAN3P7jumi15pH6";

const tmpDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** The files every scaffolded store must contain. */
const REQUIRED_FILES = [
  "agenc.config.ts",
  ".env.example",
  "package.json",
  "next.config.mjs",
  "tsconfig.json",
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/app/catalog.tsx",
  "src/app/listings/[pda]/page.tsx",
  "src/app/listings/[pda]/detail.tsx",
  "src/app/dashboard/page.tsx",
  "src/app/earnings/page.tsx",
  "src/app/trust/page.tsx",
  "src/app/providers/[pda]/page.tsx",
  "src/app/sitemap.ts",
  "src/app/robots.ts",
  "src/app/llms.txt/route.ts",
  "src/app/api/agent-card/[pda]/route.ts",
  // P5.2: the portable store identity manifest (agenc.storeManifest.v1) MUST
  // ship with every scaffold so a store is discoverable + verifiable from any
  // surface out of the box.
  "src/app/.well-known/agenc-store.json/route.ts",
  // WP-B1: the post-hire activation seam MUST ship with every scaffold — a
  // hired task is unclaimable until its job spec is pinned via this route.
  "src/app/api/agenc/activate-job-spec/route.ts",
  "src/app/api/agenc/job-specs/[hash]/route.ts",
  "src/lib/config.ts",
  "src/lib/store.ts",
  "src/lib/providers.tsx",
];

describe("parseFlags", () => {
  it("parses the project name + flags", () => {
    const flags = parseFlags([
      "node",
      "cli",
      "my-store",
      "--yes",
      "--template",
      "vertical-store",
      "--referrer",
      TEST_REFERRER,
      "--category",
      "code-generation",
    ]);
    expect(flags.projectName).toBe("my-store");
    expect(flags.yes).toBe(true);
    expect(flags.template).toBe("vertical-store");
    expect(flags.referrer).toBe(TEST_REFERRER);
    expect(flags.category).toBe("code-generation");
  });
});

describe("validateOptions", () => {
  const base: ScaffoldOptions = {
    projectName: "x",
    variant: "marketplace-store",
    storeName: "X",
    description: "d",
    network: "localnet",
    referrerWallet: TEST_REFERRER,
    referrerFeeBps: 250,
    apiBaseUrl: "http://127.0.0.1:8899",
    siteUrl: "http://localhost:3000",
    poweredBy: true,
  };

  it("accepts a valid config", () => {
    expect(validateOptions(base)).toBeNull();
  });

  it("rejects a non-base58 referrer wallet (fees must never silently drop)", () => {
    const msg = validateOptions({ ...base, referrerWallet: "not-a-wallet" });
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/base58|address|referrer/i);
  });

  it("rejects an over-cap referral fee", () => {
    const msg = validateOptions({ ...base, referrerFeeBps: 9999 });
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/bps|cap|4000/i);
  });

  // Finding #10 (major): the CLI must NOT auto-bypass the real-funds mainnet
  // gate. Choosing network=mainnet WITHOUT the deliberate allowMainnet opt-in
  // must be rejected by validateOptions (the schema superRefine), so no
  // real-funds store is produced from a bare network choice.
  it("rejects mainnet without the explicit allowMainnet opt-in (real-funds gate)", () => {
    const msg = validateOptions({ ...base, network: "mainnet" });
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/allowMainnet/);
    expect(msg).toMatch(/REAL funds/i);
    // The retired "Phase 9" framing must be gone — mainnet is live.
    expect(msg).not.toMatch(/Phase 9/);
  });

  it("accepts mainnet only WITH the deliberate allowMainnet opt-in", () => {
    expect(
      validateOptions({ ...base, network: "mainnet", allowMainnet: true }),
    ).toBeNull();
  });
});

describe("mainnet gate is not silently injected into the generated config (finding #10)", () => {
  const base: ScaffoldOptions = {
    projectName: "x",
    variant: "marketplace-store",
    storeName: "X",
    description: "d",
    network: "mainnet",
    referrerWallet: TEST_REFERRER,
    referrerFeeBps: 250,
    apiBaseUrl: "https://api.mainnet-beta.solana.com",
    siteUrl: "http://localhost:3000",
    poweredBy: true,
  };

  // Revert-sensitive: against the old code (which derived the override from
  // `network === "mainnet"`), the rendered config emitted `allowMainnet: true`
  // even with no opt-in — this assertion goes RED there.
  it("does NOT emit allowMainnet:true for mainnet without an opt-in", () => {
    const config = renderAgencConfig(base);
    expect(config).not.toContain("allowMainnet: true");
    expect(config).toContain('network: "mainnet"');
  });

  it("emits allowMainnet:true only when the deliberate opt-in is set", () => {
    const config = renderAgencConfig({ ...base, allowMainnet: true });
    expect(config).toContain("allowMainnet: true");
  });
});

describe("validateProjectName (path traversal — finding #11)", () => {
  // Revert-sensitive: against the old code (no projectName validation) these
  // names flowed straight into path.resolve and scaffolded outside the cwd;
  // each of these assertions goes RED there.
  it.each(["../../etc", "../evil", "/abs", "/tmp/evil", "a/b", "a\\b", ".", ".."])(
    "rejects the unsafe project name %j",
    (name) => {
      expect(validateProjectName(name)).not.toBeNull();
    },
  );

  it.each(["my-store", "store", "x", "my_store.v2", "Store-1"])(
    "accepts the safe single-segment name %j",
    (name) => {
      expect(validateProjectName(name)).toBeNull();
    },
  );
});

describe.each(["marketplace-store", "provider-storefront", "vertical-store"] as const)(
  "scaffold %s",
  (variant) => {
    it("produces a complete tree with a valid filled config", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), `cas-${variant}-`));
      tmpDirs.push(dir);
      const target = path.join(dir, "store");

      const opts: ScaffoldOptions = {
        projectName: "store",
        variant,
        storeName: "Test Store",
        description: "A test store.",
        network: "localnet",
        referrerWallet: TEST_REFERRER,
        referrerFeeBps: 250,
        apiBaseUrl: "http://127.0.0.1:8899",
        siteUrl: "http://localhost:3000",
        poweredBy: true,
        ...(variant === "provider-storefront"
          ? { providerPda: TEST_REFERRER }
          : {}),
        ...(variant === "vertical-store"
          ? { category: "code-generation" }
          : {}),
      };

      // Pre-write validation must pass.
      expect(validateOptions(opts)).toBeNull();

      const written = await scaffold(opts, target);
      expect(written).toContain("agenc.config.ts");

      // Every required file exists.
      for (const rel of REQUIRED_FILES) {
        expect(await exists(path.join(target, rel)), `missing ${rel}`).toBe(true);
      }

      // The generated config carries the deployer's values.
      const config = await readFile(path.join(target, "agenc.config.ts"), "utf8");
      expect(config).toContain(TEST_REFERRER);
      expect(config).toContain("Test Store");
      expect(config).toContain('from "@tetsuo-ai/store-core/config"');
      // The cross-node trust choice is EXPLICIT in every generated config —
      // "edge-list" (own attestor only) is the default; the comment block in
      // the rendered file documents when to switch to "any-bonded-attestor".
      expect(config).toContain('trustPolicy: "edge-list"');
      if (variant === "vertical-store") {
        expect(config).toContain('categories: ["code-generation"]');
      }
      if (variant === "provider-storefront") {
        expect(config).toContain(`providers: ["${TEST_REFERRER}"]`);
      }

      // The package name was rewritten.
      const pkg = JSON.parse(
        await readFile(path.join(target, "package.json"), "utf8"),
      ) as { name: string };
      expect(pkg.name).toBe("store");
    });

    it("refuses to scaffold into a non-empty directory", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), `cas-busy-${variant}-`));
      tmpDirs.push(dir);
      const target = path.join(dir, "store");
      const opts: ScaffoldOptions = {
        projectName: "store",
        variant,
        storeName: "X",
        description: "d",
        network: "localnet",
        referrerWallet: TEST_REFERRER,
        referrerFeeBps: 250,
        apiBaseUrl: "http://127.0.0.1:8899",
        siteUrl: "http://localhost:3000",
        poweredBy: true,
        ...(variant === "provider-storefront" ? { providerPda: TEST_REFERRER } : {}),
        ...(variant === "vertical-store" ? { category: "code-generation" } : {}),
      };
      await scaffold(opts, target);
      // Second scaffold into the now-populated dir must throw.
      await expect(scaffold(opts, target)).rejects.toThrow(/not empty/i);
    });
  },
);
