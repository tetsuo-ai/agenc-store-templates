/**
 * Unit tests for the activation seam's review-hardened server surface
 * (WP-B1 follow-up):
 *
 * - `buildListingJobSpec` bounds the composed deliverable (an over-long
 *   listing `specUri` must degrade, never deterministically fail activation
 *   AFTER the hire is funded);
 * - the route handler's `verifyTask` gate (public route ≠ free spec-hosting /
 *   attestation proxy) runs BEFORE any hosting or attestation side effect;
 * - the route handler's per-client rate limit;
 * - the file store's distinct-document quota (griefing bound) with idempotent
 *   re-hosting at the cap;
 * - `resolveActivationBackend`'s serverless/ephemeral-filesystem guard and the
 *   `AGENC_JOB_SPEC_DIR` durable-volume override;
 * - the `job-spec-hosting` mainnet go-live check.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildListingJobSpec,
  JOB_SPEC_LIMITS,
  normalizeStoreJobSpec,
} from "../src/activation/job-spec.js";
import {
  createStoreActivationHost,
  fetchStoreHireModerator,
} from "../src/activation/client.js";
import {
  attestorInfoUrl,
  createActivateJobSpecHandler,
  createFileJobSpecStore,
  createMemoryJobSpecStore,
  fetchAttestorModerator,
  probeJobSpecHostingDurability,
  resolveActivationBackend,
  resolveJobSpecDirectory,
  type StoreJobSpecHostInput,
} from "../src/activation/server.js";
import {
  checkMainnetGoLive,
  defineStore,
  detectEphemeralHosting,
} from "../src/config/index.js";

const TASK_PDA = "7RkbpXC7sPVNYSLVkaxChHgXNa4J8B4kgBhzRZzjTkHc";
const LISTING_PDA = "8iC21EoERDWSXRc5AH8fQBaV32pMSsAN3P7jumi15pH6";
/** The P1.2 moderator every CLEAN attestor stub names. */
const MODERATOR = "13tuj7ELwtHmeR22kvaSaa2pKqSscyoHtQBF65aHuo6v";

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cas-activation-"));
  tmpDirs.push(dir);
  return dir;
}

function activationRequest(body: unknown, ip = "203.0.113.7"): Request {
  return new Request("http://store.local/api/agenc/activate-job-spec", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

function validBody(): Record<string, unknown> {
  return {
    taskPda: TASK_PDA,
    listing: LISTING_PDA,
    jobSpec: buildListingJobSpec({ listingName: "Analyst" }),
  };
}

describe("buildListingJobSpec deliverable bound (post-hire must never 400 deterministically)", () => {
  it("keeps a normal specUri in the deliverable", () => {
    const uri = "https://store.example.com/spec";
    const draft = buildListingJobSpec({ listingName: "X", specUri: uri });
    expect(draft.deliverables[0]).toContain(uri);
    expect(
      draft.deliverables[0]!.length,
    ).toBeLessThanOrEqual(JOB_SPEC_LIMITS.itemChars);
  });

  it("degrades a 256-char specUri to the no-URI deliverable and still normalizes", () => {
    // On-chain listing URIs cap near 256 bytes — a hostile/sloppy provider can
    // fill that. The composed deliverable must stay within itemChars.
    const uri = `https://x.example/${"a".repeat(238)}`;
    expect(uri.length).toBe(256);
    const draft = buildListingJobSpec({ listingName: "X", specUri: uri });
    expect(draft.deliverables[0]).not.toContain(uri);
    expect(
      draft.deliverables[0]!.length,
    ).toBeLessThanOrEqual(JOB_SPEC_LIMITS.itemChars);
    // The whole draft passes the route's normalization (which REJECTS items
    // over the bound) — i.e. activation cannot be bricked by the listing.
    expect(() =>
      normalizeStoreJobSpec(TASK_PDA, LISTING_PDA, draft),
    ).not.toThrow();
  });
});

describe("activation route: verifyTask gate", () => {
  it("409s and performs NO side effects when the task is not activatable", async () => {
    const hosting = createMemoryJobSpecStore({
      publicBaseUrl: "http://localhost:3000/api/agenc/job-specs",
    });
    let attestorCalled = false;
    const handler = createActivateJobSpecHandler({
      storeJobSpec: hosting.storeJobSpec,
      attestTaskModeration: async () => {
        attestorCalled = true;
        return { attested: true };
      },
      verifyTask: async () => ({ ok: false, reason: "task does not exist" }),
      rateLimit: false,
    });
    const response = await handler(activationRequest(validBody()));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/task verification failed/i);
    expect(body.error).toMatch(/does not exist/i);
    expect(hosting.hosted.size).toBe(0);
    expect(attestorCalled).toBe(false);
  });

  it("a throwing verifyTask fails closed (409), never 500", async () => {
    const hosting = createMemoryJobSpecStore({
      publicBaseUrl: "http://localhost:3000/api/agenc/job-specs",
    });
    const handler = createActivateJobSpecHandler({
      storeJobSpec: hosting.storeJobSpec,
      attestTaskModeration: async () => ({ attested: true }),
      verifyTask: async () => {
        throw new Error("rpc unreachable");
      },
      rateLimit: false,
    });
    const response = await handler(activationRequest(validBody()));
    expect(response.status).toBe(409);
    expect(hosting.hosted.size).toBe(0);
  });

  it("proceeds when verifyTask passes", async () => {
    const hosting = createMemoryJobSpecStore({
      publicBaseUrl: "http://localhost:3000/api/agenc/job-specs",
    });
    const handler = createActivateJobSpecHandler({
      storeJobSpec: hosting.storeJobSpec,
      attestTaskModeration: async () => ({ attested: true, moderator: MODERATOR }),
      verifyTask: async (pda) => ({ ok: pda === TASK_PDA }),
      rateLimit: false,
    });
    const response = await handler(activationRequest(validBody()));
    expect(response.status).toBe(200);
    expect(hosting.hosted.size).toBe(1);
  });
});

describe("activation route: per-client rate limit", () => {
  it("429s a client that exceeds the window limit; other clients unaffected", async () => {
    const hosting = createMemoryJobSpecStore({
      publicBaseUrl: "http://localhost:3000/api/agenc/job-specs",
    });
    const handler = createActivateJobSpecHandler({
      storeJobSpec: hosting.storeJobSpec,
      attestTaskModeration: async () => ({ attested: true, moderator: MODERATOR }),
      rateLimit: { limit: 2, windowMs: 60_000 },
    });
    expect((await handler(activationRequest(validBody(), "10.0.0.1"))).status).toBe(200);
    expect((await handler(activationRequest(validBody(), "10.0.0.1"))).status).toBe(200);
    const third = await handler(activationRequest(validBody(), "10.0.0.1"));
    expect(third.status).toBe(429);
    // A different client key is still served.
    expect((await handler(activationRequest(validBody(), "10.0.0.2"))).status).toBe(200);
  });
});

describe("file job-spec store: distinct-document quota", () => {
  it("caps NEW documents but always allows re-hosting an existing hash", async () => {
    const dir = await tmpDir();
    const store = createFileJobSpecStore({
      directory: dir,
      publicBaseUrl: "http://localhost:3000/api/agenc/job-specs",
      maxHostedSpecs: 2,
    });
    const input = (n: number): StoreJobSpecHostInput => ({
      taskPda: TASK_PDA,
      jobSpecHashHex: `${String(n).repeat(2)}`.padEnd(64, "e"),
      payload: {} as StoreJobSpecHostInput["payload"],
      canonicalJson: `{"n":${n}}`,
    });
    await store(input(1));
    await store(input(2));
    await expect(store(input(3))).rejects.toThrow(/cap/i);
    // Idempotent re-host of an existing document at the cap still works —
    // an activation RETRY must never be starved by earlier griefing.
    await expect(store(input(1))).resolves.toEqual({
      uri: `http://localhost:3000/api/agenc/job-specs/${input(1).jobSpecHashHex}`,
    });
    expect((await readdir(dir)).length).toBe(2);
  });
});

describe("resolveActivationBackend: serverless/ephemeral hosting guard", () => {
  const config = defineStore({
    name: "Guard Store",
    description: "d",
    network: "devnet",
    api: { baseUrl: "https://indexer.example.com" },
    referrer: {
      wallet: "8iC21EoERDWSXRc5AH8fQBaV32pMSsAN3P7jumi15pH6",
      feeBps: 250,
    },
    seo: { siteUrl: "https://store.example.com" },
  });

  it("fails hosting loudly (actionable) on a detected serverless platform", async () => {
    const backend = resolveActivationBackend(config, { VERCEL: "1" });
    expect(backend.hosting).toBe("unsupported-ephemeral");
    expect(backend.hostingIssue).toMatch(/Vercel/);
    expect(backend.hostingIssue).toMatch(/AGENC_JOB_SPEC_DIR/);
    await expect(
      backend.storeJobSpec({
        taskPda: TASK_PDA,
        jobSpecHashHex: "ab".repeat(32),
        payload: {} as StoreJobSpecHostInput["payload"],
        canonicalJson: "{}",
      }),
    ).rejects.toThrow(/Vercel/);
    // ...and the route surfaces that reason in its 502 body.
    const handler = createActivateJobSpecHandler({
      storeJobSpec: backend.storeJobSpec,
      attestTaskModeration: async () => ({ attested: true }),
      rateLimit: false,
    });
    const response = await handler(activationRequest(validBody()));
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/AGENC_JOB_SPEC_DIR/);
  });

  it("honors the AGENC_JOB_SPEC_DIR durable-volume override on the same platform", async () => {
    const dir = await tmpDir();
    const env = { VERCEL: "1", AGENC_JOB_SPEC_DIR: dir };
    const backend = resolveActivationBackend(config, env);
    expect(backend.hosting).toBe("file");
    expect(backend.hostingIssue).toBeNull();
    expect(backend.jobSpecDirectory).toBe(path.resolve(dir));
    // The GET route resolves the SAME directory (host↔serve coherence).
    expect(resolveJobSpecDirectory(env)).toBe(path.resolve(dir));
    const hash = "cd".repeat(32);
    const stored = await backend.storeJobSpec({
      taskPda: TASK_PDA,
      jobSpecHashHex: hash,
      payload: {} as StoreJobSpecHostInput["payload"],
      canonicalJson: '{"ok":true}',
    });
    expect(stored.uri).toBe(
      `https://store.example.com/api/agenc/job-specs/${hash}`,
    );
    expect(
      await readFile(path.join(dir, `${hash}.json`), "utf8"),
    ).toBe('{"ok":true}\n');
    // The write+readback probe passes on a real directory.
    expect(await probeJobSpecHostingDurability(dir)).toEqual({
      ok: true,
      message: null,
    });
  });

  it("wires an RPC task verifier for the route", () => {
    const backend = resolveActivationBackend(config, {});
    expect(typeof backend.verifyTask).toBe("function");
  });
});

describe("mainnet go-live: job-spec-hosting check", () => {
  const mainnetConfig = defineStore({
    name: "Live Store",
    description: "d",
    network: "mainnet",
    allowMainnet: true,
    api: { baseUrl: "https://indexer.example.com" },
    referrer: {
      wallet: "8iC21EoERDWSXRc5AH8fQBaV32pMSsAN3P7jumi15pH6",
      feeBps: 250,
    },
    seo: { siteUrl: "https://store.example.com" },
  });

  it("detects serverless platforms from env markers", () => {
    expect(detectEphemeralHosting({ VERCEL: "1" })).toBe("Vercel");
    expect(detectEphemeralHosting({ NETLIFY: "true" })).toBe("Netlify");
    expect(detectEphemeralHosting({})).toBeNull();
  });

  it("fails on a serverless platform without a durable directory", () => {
    const result = checkMainnetGoLive(mainnetConfig, { VERCEL: "1" });
    const hosting = result.checks.find((c) => c.id === "job-spec-hosting");
    expect(hosting?.ok).toBe(false);
    expect(hosting?.message).toMatch(/AGENC_JOB_SPEC_DIR/);
    expect(result.ready).toBe(false);
  });

  it("passes with AGENC_JOB_SPEC_DIR set, and on non-serverless hosts", () => {
    const withDir = checkMainnetGoLive(mainnetConfig, {
      VERCEL: "1",
      AGENC_JOB_SPEC_DIR: "/mnt/agenc-job-specs",
    });
    expect(
      withDir.checks.find((c) => c.id === "job-spec-hosting")?.ok,
    ).toBe(true);
    const plain = checkMainnetGoLive(mainnetConfig, {});
    expect(
      plain.checks.find((c) => c.id === "job-spec-hosting")?.ok,
    ).toBe(true);
    expect(plain.ready).toBe(true);
  });
});

describe("P1.2 moderator sourcing (fail-closed)", () => {
  function cleanHandler(deps?: {
    moderator?: string | null;
    moderatorOverride?: string;
    resolveHireModerator?: () => Promise<string>;
  }) {
    const hosting = createMemoryJobSpecStore({
      publicBaseUrl: "http://localhost:3000/api/agenc/job-specs",
    });
    const handler = createActivateJobSpecHandler({
      storeJobSpec: hosting.storeJobSpec,
      attestTaskModeration: async () => ({
        attested: true,
        moderator: deps?.moderator ?? null,
        moderation: { status: "CLEAN" },
      }),
      moderatorOverride: deps?.moderatorOverride,
      resolveHireModerator: deps?.resolveHireModerator,
      rateLimit: false,
    });
    return { hosting, handler };
  }

  it("responds with the attestation response's moderator (source b)", async () => {
    const { handler } = cleanHandler({ moderator: MODERATOR });
    const response = await handler(activationRequest(validBody()));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { moderator: string };
    expect(body.moderator).toBe(MODERATOR);
  });

  it("the attestation response's moderator WINS over the config override", async () => {
    const { handler } = cleanHandler({
      moderator: MODERATOR,
      moderatorOverride: LISTING_PDA,
    });
    const response = await handler(activationRequest(validBody()));
    const body = (await response.json()) as { moderator: string };
    // The record consumed on-chain was written by whoever just signed it.
    expect(body.moderator).toBe(MODERATOR);
  });

  it("falls back to the moderation.moderator config override (source a)", async () => {
    const { handler } = cleanHandler({
      moderator: null,
      moderatorOverride: MODERATOR,
    });
    const response = await handler(activationRequest(validBody()));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { moderator: string };
    expect(body.moderator).toBe(MODERATOR);
  });

  it("502s (fail-closed, actionable) when an attested response names no moderator", async () => {
    const { handler } = cleanHandler({ moderator: null });
    const response = await handler(activationRequest(validBody()));
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/moderator/i);
    expect(body.error).toMatch(/agenc-moderation-api/);
    expect(body.error).toMatch(/moderation\.moderator/);
  });

  it("the browser host REFUSES a route response without a moderator (never guesses)", async () => {
    const host = createStoreActivationHost({
      endpoint: "http://store.local/api/agenc/activate-job-spec",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            jobSpecHashHex: "ab".repeat(32),
            jobSpecUri: "http://localhost:3000/api/agenc/job-specs/x",
            moderationAttested: true,
            // no moderator — an outdated store route
          }),
          { status: 200 },
        )) as typeof fetch,
    });
    await expect(
      host({
        taskPda: TASK_PDA,
        taskId: new Uint8Array(32).fill(1),
        listing: LISTING_PDA,
        jobSpec: buildListingJobSpec({ listingName: "X" }),
        hireSignature: "sig",
        referrerInjected: false,
      }),
    ).rejects.toThrow(/moderator/i);
  });

  it("GET serves the hire-gate moderator; a failing resolver 502s with the reason", async () => {
    const { handler } = cleanHandler({
      moderator: MODERATOR,
      resolveHireModerator: async () => MODERATOR,
    });
    const get = await handler(
      new Request("http://store.local/api/agenc/activate-job-spec"),
    );
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ moderator: MODERATOR });

    const { handler: failing } = cleanHandler({
      moderator: MODERATOR,
      resolveHireModerator: async () => {
        throw new Error("attestor /v1/info unreachable");
      },
    });
    const bad = await failing(
      new Request("http://store.local/api/agenc/activate-job-spec"),
    );
    expect(bad.status).toBe(502);
    expect(((await bad.json()) as { error: string }).error).toMatch(
      /unreachable/,
    );
  });

  it("GET without a wired resolver stays 405 (POST-only route)", async () => {
    const { handler } = cleanHandler({ moderator: MODERATOR });
    const response = await handler(
      new Request("http://store.local/api/agenc/activate-job-spec"),
    );
    expect(response.status).toBe(405);
  });

  it("fetchStoreHireModerator resolves + caches per endpoint and fails closed", async () => {
    let calls = 0;
    const okFetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ moderator: MODERATOR }), {
        status: 200,
      });
    }) as typeof fetch;
    const endpoint = `/api/agenc/activate-job-spec?t=${Date.now()}`;
    expect(await fetchStoreHireModerator({ endpoint, fetch: okFetch })).toBe(
      MODERATOR,
    );
    expect(await fetchStoreHireModerator({ endpoint, fetch: okFetch })).toBe(
      MODERATOR,
    );
    expect(calls).toBe(1); // session cache

    const noModerator = (async () =>
      new Response(JSON.stringify({}), { status: 200 })) as typeof fetch;
    await expect(
      fetchStoreHireModerator({
        endpoint: `${endpoint}&fresh=1`,
        fetch: noModerator,
      }),
    ).rejects.toThrow(/moderator/i);
  });

  it("attestorInfoUrl derives /v1/info from the attest endpoint origin", () => {
    expect(
      attestorInfoUrl("https://attest.agenc.ag/api/task-moderation/attest"),
    ).toBe("https://attest.agenc.ag/v1/info");
    expect(
      attestorInfoUrl("http://localhost:8402/api/task-moderation/attest"),
    ).toBe("http://localhost:8402/v1/info");
  });

  it("fetchAttestorModerator reads /v1/info and fails closed without a moderator", async () => {
    const seen: string[] = [];
    const infoFetch = (async (url: RequestInfo | URL) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ ok: true, moderator: MODERATOR }), {
        status: 200,
      });
    }) as typeof fetch;
    // Unique origin per run so the per-process cache cannot cross-talk.
    const origin = `https://attestor-${Date.now()}.example.com`;
    expect(
      await fetchAttestorModerator({
        attestorEndpoint: `${origin}/api/task-moderation/attest`,
        fetch: infoFetch,
      }),
    ).toBe(MODERATOR);
    expect(seen).toEqual([`${origin}/v1/info`]);
    // Cached: no second network call.
    expect(
      await fetchAttestorModerator({
        attestorEndpoint: `${origin}/api/task-moderation/attest`,
        fetch: infoFetch,
      }),
    ).toBe(MODERATOR);
    expect(seen).toHaveLength(1);

    const bare = (async () =>
      new Response(JSON.stringify({ ok: true, moderator: null }), {
        status: 200,
      })) as typeof fetch;
    await expect(
      fetchAttestorModerator({
        attestorEndpoint: `${origin}-outdated/api/task-moderation/attest`,
        fetch: bare,
      }),
    ).rejects.toThrow(/moderator|0\.2\.1/i);
  });

  it("resolveActivationBackend surfaces the config override + a hire-moderator resolver", async () => {
    const config = defineStore({
      name: "Mod Store",
      description: "d",
      network: "devnet",
      api: { baseUrl: "https://indexer.example.com" },
      referrer: { wallet: LISTING_PDA, feeBps: 250 },
      seo: { siteUrl: "https://store.example.com" },
      moderation: { moderator: MODERATOR },
    });
    const backend = resolveActivationBackend(config, {});
    expect(backend.moderatorOverride).toBe(MODERATOR);
    // The override short-circuits the resolver — no network needed.
    expect(await backend.resolveHireModerator()).toBe(MODERATOR);
  });
});
