/**
 * FAKE-lifecycle test (WP-B1) — the mocked-chain half of the new lifecycle
 * coverage (the litesvm-signed half lives in
 * `store-core/test/lifecycle-signed.test.ts`). No transaction is signed here;
 * instead this locks the SHAPES a scaffolded store drives through the
 * hire→activation flow:
 *
 *   scaffold (real CLI scaffolder, temp dir)
 *     → the scaffolded agenc.config.ts validates via store-core's schema
 *     → the template's hire input shape (fresh 32-byte taskId, CAS guards,
 *       review window — humanless/creator/referrer legs deliberately absent:
 *       they are flow/provider-level)
 *     → the ACTIVATION-CALL shape: the real store-core activation route
 *       handler (in-memory hosting + a fake attestor) is driven through the
 *       real browser-side host, and the resulting `setTaskJobSpec` argument
 *       shape is asserted (32-byte canonical hash matching the hosted JSON,
 *       ≤ 256-byte URI, derived task PDA).
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { address } from "@solana/kit";
import { findTaskPda, values } from "@tetsuo-ai/marketplace-sdk";
import { safeDefineStore } from "@tetsuo-ai/store-core/config";
import {
  buildListingJobSpec,
  createStoreActivationHost,
  normalizeStoreJobSpec,
  STORE_JOB_SPEC_SCHEMA,
} from "@tetsuo-ai/store-core/activation";
import {
  createActivateJobSpecHandler,
  createMemoryJobSpecStore,
  type TaskModerationInput,
} from "@tetsuo-ai/store-core/activation/server";
import { scaffold } from "../src/scaffold.js";
import type { ScaffoldOptions } from "../src/config.js";

const TEST_REFERRER = "8iC21EoERDWSXRc5AH8fQBaV32pMSsAN3P7jumi15pH6";
// Real base58 PDAs (shape-valid for the route's validation).
const LISTING_PDA = "7RkbpXC7sPVNYSLVkaxChHgXNa4J8B4kgBhzRZzjTkHc";
// The P1.2 moderator the fake attestor names (any base58 pubkey shape).
const MODERATOR = "13tuj7ELwtHmeR22kvaSaa2pKqSscyoHtQBF65aHuo6v";

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** The hire-input factory shape every template's detail.tsx uses. */
function buildTemplateHireInput(listing: {
  address: string;
  account: { price: bigint; version: bigint; specHash: Uint8Array };
}) {
  const taskId = new Uint8Array(32);
  for (let i = 0; i < 32; i++) taskId[i] = (i * 7 + 3) % 256;
  return {
    listing: listing.address,
    taskId,
    expectedPrice: listing.account.price,
    expectedVersion: listing.account.version,
    listingSpecHash: listing.account.specHash,
    reviewWindowSecs: 7 * 24 * 60 * 60,
  };
}

describe("fake lifecycle: scaffold-config → listing → hire → activation-call shape", () => {
  it("runs the whole mocked flow with the real scaffolder + activation seam", async () => {
    // ---- 1) scaffold a real store into a temp dir ------------------------
    const dir = await mkdtemp(path.join(os.tmpdir(), "cas-lifecycle-"));
    tmpDirs.push(dir);
    const target = path.join(dir, "store");
    const opts: ScaffoldOptions = {
      projectName: "store",
      variant: "marketplace-store",
      storeName: "Fake Lifecycle Store",
      description: "d",
      network: "localnet",
      referrerWallet: TEST_REFERRER,
      referrerFeeBps: 250,
      apiBaseUrl: "http://127.0.0.1:8899",
      siteUrl: "http://localhost:3000",
      poweredBy: true,
    };
    await scaffold(opts, target);

    // The scaffolded tree ships the activation seam.
    const activateRoute = await readFile(
      path.join(target, "src/app/api/agenc/activate-job-spec/route.ts"),
      "utf8",
    );
    expect(activateRoute).toContain("createActivateJobSpecHandler");
    expect(activateRoute).toContain("resolveActivationBackend");

    // ---- 2) the scaffold-shaped config validates -------------------------
    const config = safeDefineStore({
      name: opts.storeName,
      description: opts.description,
      network: opts.network,
      api: { baseUrl: opts.apiBaseUrl },
      referrer: { wallet: opts.referrerWallet, feeBps: opts.referrerFeeBps },
      // The scaffolder now emits the cross-node trust choice explicitly —
      // this MUST validate through the real store-core schema (strict object:
      // an unknown key would fail safeDefineStore, so this goes RED if the
      // schema loses/renames `moderation.trustPolicy`).
      moderation: { trustPolicy: "edge-list" },
      seo: { siteUrl: opts.siteUrl },
    });
    expect(config.success).toBe(true);
    if (!config.success) return;

    // ---- 3) the hire-call shape (mocked chain) ----------------------------
    const listing = {
      address: LISTING_PDA,
      account: {
        price: 5_000_000n,
        version: 1n,
        specHash: new Uint8Array(32).fill(7),
      },
    };
    const hireInput = buildTemplateHireInput(listing);
    expect(hireInput.taskId).toHaveLength(32);
    expect(hireInput.expectedPrice).toBe(5_000_000n);
    expect(hireInput.expectedVersion).toBe(1n);
    expect(hireInput.listingSpecHash).toHaveLength(32);
    expect(hireInput.reviewWindowSecs).toBeGreaterThan(0);
    // The flow/provider own these legs — the template input must NOT set them.
    expect(hireInput).not.toHaveProperty("humanless");
    expect(hireInput).not.toHaveProperty("creator");
    expect(hireInput).not.toHaveProperty("referrer");
    expect(hireInput).not.toHaveProperty("referrerFeeBps");
    // The connected store button derives this from the exact future Task PDA
    // and normalized draft; a template caller cannot accidentally bind a
    // listing hash or another task's contract here.
    expect(hireInput).not.toHaveProperty("taskJobSpecHash");

    // The task PDA the flow derives after the (mocked) hire.
    const [taskPda] = await findTaskPda({
      creator: address(TEST_REFERRER), // any base58 wallet works for shape purposes
      taskId: hireInput.taskId,
    });

    // ---- 4) the activation-call shape through the REAL seam ---------------
    const hosting = createMemoryJobSpecStore({
      publicBaseUrl: `${opts.siteUrl}/api/agenc/job-specs`,
    });
    const attested: TaskModerationInput[] = [];
    const handler = createActivateJobSpecHandler({
      storeJobSpec: hosting.storeJobSpec,
      attestTaskModeration: async (input) => {
        attested.push(input);
        // P1.2: real attestors name their signer in every response.
        return {
          attested: true,
          moderator: MODERATOR,
          moderation: { status: "CLEAN" },
        };
      },
    });
    const host = createStoreActivationHost({
      endpoint: "http://store.local/api/agenc/activate-job-spec",
      fetch: (async (url: string | URL | Request, init?: RequestInit) =>
        handler(new Request(url, init))) as typeof fetch,
    });

    const jobSpec = buildListingJobSpec({
      listingName: "Fake Analyst",
      brief: "Do the thing.",
    });
    const fundedTaskContract = await values.canonicalJobSpecHash(
      normalizeStoreJobSpec(
        String(taskPda),
        listing.address,
        jobSpec,
      ),
    );
    const result = await host({
      taskPda: String(taskPda),
      taskId: hireInput.taskId,
      listing: listing.address,
      jobSpec,
      hireSignature: "fake-signature",
      referrerInjected: true,
    });

    // The exact setTaskJobSpec argument shape the flow will sign with:
    expect(result.moderationAttested).toBe(true);
    expect(result.jobSpecHash).toBeInstanceOf(Uint8Array);
    expect(result.jobSpecHash).toHaveLength(32);
    expect(result.jobSpecHash).toEqual(fundedTaskContract.bytes);
    // P1.2: the moderator whose record the activation names — sourced from
    // the attestation response, never guessed.
    expect(result.moderator).toBe(MODERATOR);
    expect(result.jobSpecUri.length).toBeGreaterThan(0);
    expect(result.jobSpecUri.length).toBeLessThanOrEqual(256); // on-chain cap

    // The attestor saw the SAME (task, hash) pair that gets pinned.
    expect(attested).toHaveLength(1);
    expect(attested[0]?.taskPda).toBe(String(taskPda));
    expect(values.hexToBytes(attested[0]!.jobSpecHashHex)).toEqual(
      result.jobSpecHash,
    );

    // The hosted canonical JSON re-hashes to the pinned hash and carries the
    // normalized store schema + task/listing binding.
    const hostedJson = hosting.hosted.get(
      values.bytesToHex(result.jobSpecHash),
    );
    expect(hostedJson).toBeDefined();
    const payload = JSON.parse(hostedJson!) as Record<string, unknown>;
    expect(payload.schema).toBe(STORE_JOB_SPEC_SCHEMA);
    expect(payload.taskPda).toBe(String(taskPda));
    expect(payload.listing).toBe(listing.address);
    expect(payload.notes).toBe("Do the thing.");
    const recomputed = await values.canonicalJobSpecHash(payload);
    expect(recomputed.hex).toBe(values.bytesToHex(result.jobSpecHash));
  });

  it("the activation host refuses an unattested spec (never signs blind)", async () => {
    const hosting = createMemoryJobSpecStore({
      publicBaseUrl: "http://localhost:3000/api/agenc/job-specs",
    });
    const handler = createActivateJobSpecHandler({
      storeJobSpec: hosting.storeJobSpec,
      attestTaskModeration: async () => ({ attested: false }),
    });
    const host = createStoreActivationHost({
      endpoint: "http://store.local/api/agenc/activate-job-spec",
      fetch: (async (url: string | URL | Request, init?: RequestInit) =>
        handler(new Request(url, init))) as typeof fetch,
    });
    await expect(
      host({
        taskPda: LISTING_PDA,
        taskId: new Uint8Array(32).fill(2),
        listing: LISTING_PDA,
        jobSpec: buildListingJobSpec({ listingName: "X" }),
        hireSignature: "sig",
        referrerInjected: false,
      }),
    ).rejects.toThrow(/did not attest/i);
  });

  it("the route refuses a task the store cannot verify (no hosting, no attestation)", async () => {
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
      verifyTask: async () => ({ ok: false, reason: "task not found" }),
    });
    const host = createStoreActivationHost({
      endpoint: "http://store.local/api/agenc/activate-job-spec",
      fetch: (async (url: string | URL | Request, init?: RequestInit) =>
        handler(new Request(url, init))) as typeof fetch,
    });
    await expect(
      host({
        taskPda: LISTING_PDA,
        taskId: new Uint8Array(32).fill(3),
        listing: LISTING_PDA,
        jobSpec: buildListingJobSpec({ listingName: "X" }),
        hireSignature: "sig",
        referrerInjected: false,
      }),
    ).rejects.toThrow(/task verification failed/i);
    expect(hosting.hosted.size).toBe(0);
    expect(attestorCalled).toBe(false);
  });

  it("the route rejects an oversized or malformed job spec before hashing", async () => {
    const hosting = createMemoryJobSpecStore({
      publicBaseUrl: "http://localhost:3000/api/agenc/job-specs",
    });
    const handler = createActivateJobSpecHandler({
      storeJobSpec: hosting.storeJobSpec,
      attestTaskModeration: async () => ({ attested: true }),
    });
    // Missing deliverables → 400 with an actionable field error.
    const bad = await handler(
      new Request("http://store.local/api/agenc/activate-job-spec", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskPda: LISTING_PDA,
          listing: LISTING_PDA,
          jobSpec: { title: "no deliverables" },
        }),
      }),
    );
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: string };
    expect(body.error).toMatch(/deliverables/);
    expect(hosting.hosted.size).toBe(0); // nothing hosted on failure
  });
});
