/**
 * SIGNED store lifecycle test (WP-B1) — the REAL compiled agenc-coordination
 * program running in litesvm (`startLocalMarketplace`, in-process, no
 * validator, no network, no real keys), driven through the exact seams a
 * deployed store template uses:
 *
 *   scaffold-shaped store config (defineStore: referrer + operator terms)
 *     → provider registers + creates a listing WITH the config's operator
 *       terms (`listingOperatorTerms` → `createServiceListing`)
 *     → CLEAN listing attestation
 *     → humanless hire with the PROVIDER-LEVEL referrer injection pair
 *       (store wallet + feeBps) — signed by a plain buyer wallet
 *     → post-hire activation through store-core's REAL activation seam:
 *       `createStoreActivationHost` (the browser half) POSTing into
 *       `createActivateJobSpecHandler` (the route half), canonical hash +
 *       hosted JSON + CLEAN task attestation → buyer signs `setTaskJobSpec`
 *     → worker claims (claimTaskWithJobSpec — ONLY possible because the job
 *       spec was pinned), submits
 *     → buyer review-accepts → settlement pays the worker AND the exact
 *       operator + referrer legs.
 *
 * Every transaction here is SIGNED and executed by the deployed program's
 * bytecode — this is the proof that a hired store task is claimable and
 * settles the store's economics end to end. Requires Node 24+ (litesvm hangs
 * test forks on Node ≤22).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { address, type Address, type KeyPairSigner } from "@solana/kit";
import {
  facade,
  findAgentPda,
  findEscrowPda,
  findTaskPda,
  values,
} from "@tetsuo-ai/marketplace-sdk";
import { startLocalMarketplace } from "@tetsuo-ai/marketplace-sdk/testing";
import type { LocalMarketplace } from "@tetsuo-ai/marketplace-sdk/testing";
import { defineStore, listingOperatorTerms } from "../src/config/index.js";
import {
  buildListingJobSpec,
  createStoreActivationHost,
} from "../src/activation/index.js";
import {
  createActivateJobSpecHandler,
  createMemoryJobSpecStore,
} from "../src/activation/server.js";

const PRICE = 5_000_000n;
const OPERATOR_FEE_BPS = 1000; // 10% — the store operator's listing-creation leg
const REFERRER_FEE_BPS = 250; // 2.5% — the store owner's per-hire referral leg
const SPEC_HASH = new Uint8Array(32).fill(7);

let market: LocalMarketplace;
let provider: KeyPairSigner;
let providerAgent: Address;
let listingPda: Address;
let buyer: KeyPairSigner;
let operatorWallet: Address;
let referrerWallet: Address;

beforeAll(async () => {
  market = await startLocalMarketplace();

  // Standalone wallets for the two fee legs so their balance deltas are pure.
  operatorWallet = (await market.fundedSigner(1_000_000_000n)).address;
  referrerWallet = (await market.fundedSigner(1_000_000_000n)).address;
}, 120_000);

describe("signed store lifecycle (litesvm, real program)", () => {
  it(
    "hire → activation → claim → submit → accept settles worker + operator + referrer",
    { timeout: 120_000 },
    async () => {
      // ---- 0) The store config, exactly scaffold-shaped -------------------
      const storeConfig = defineStore({
        name: "Lifecycle Store",
        description: "Signed lifecycle store.",
        network: "localnet",
        api: { baseUrl: "http://127.0.0.1:8899" },
        referrer: { wallet: String(referrerWallet), feeBps: REFERRER_FEE_BPS },
        operator: { wallet: String(operatorWallet), feeBps: OPERATOR_FEE_BPS },
        seo: { siteUrl: "https://store.example.com" },
      });

      // ---- 1) Provider registers + lists WITH the config's operator terms -
      provider = await market.fundedSigner();
      const providerClient = market.clientFor(provider);
      const agentId = new Uint8Array(32).fill(11);
      await providerClient.registerAgent({
        authority: provider,
        agentId,
        capabilities: 1n,
        endpoint: "http://provider.test",
        metadataUri: null,
        stakeAmount: 0n,
      });
      [providerAgent] = await findAgentPda({ agentId });

      const listingId = new Uint8Array(32).fill(33);
      const terms = listingOperatorTerms(storeConfig);
      expect(terms).toEqual({
        operator: String(operatorWallet),
        operatorFeeBps: OPERATOR_FEE_BPS,
      });
      await providerClient.createServiceListing({
        providerAgent,
        authority: provider,
        listingId,
        name: values.encodeListingName("Lifecycle Analyst"),
        category: values.encodeListingCategory("data-analysis"),
        tags: values.encodeListingTags(["sql"]),
        specHash: SPEC_HASH,
        specUri: "https://store.example.com/spec",
        price: PRICE,
        priceMint: null,
        requiredCapabilities: 1n,
        defaultDeadlineSecs: 3600n,
        maxOpenJobs: 0,
        operator: terms.operator === null ? null : address(terms.operator),
        operatorFeeBps: terms.operatorFeeBps,
      });
      [listingPda] = await facade.findListingPda({ providerAgent, listingId });

      // CLEAN listing attestation (the fail-closed hire gate).
      await market.moderator.attestListing(listingPda, SPEC_HASH);

      // ---- 2) Humanless hire, provider-level referrer injected ------------
      buyer = await market.fundedSigner();
      const buyerClient = market.clientFor(buyer);
      const taskId = new Uint8Array(32).fill(44);
      await buyerClient.hireFromListingHumanless({
        listing: listingPda,
        providerAgent,
        creator: buyer,
        taskId,
        expectedPrice: PRICE,
        expectedVersion: 1n,
        reviewWindowSecs: 3600n,
        listingSpecHash: SPEC_HASH,
        // P1.2: the hire gate names the moderator whose LISTING attestation
        // it consumes — here the sandbox moderation authority that recorded
        // the CLEAN attestation above (what the store sources from the
        // attestation service's /v1/info in production).
        moderator: market.moderator.address,
        // The provider-level injection pair — exactly what marketplace-react
        // spreads from AgencProvider's { referrer: { wallet, feeBps } } when
        // resolveReferrerCapability().live is true.
        referrer: address(storeConfig.referrer.wallet),
        referrerFeeBps: storeConfig.referrer.feeBps,
      });
      const [taskPda] = await findTaskPda({
        creator: buyer.address,
        taskId,
      });
      const [escrowPda] = await findEscrowPda({ task: taskPda });
      expect(market.svm.getAccount(escrowPda)?.exists).toBe(true); // escrow funded

      // ---- 3) Post-hire activation through the REAL store seam ------------
      // Route half: store-core's activation handler with in-memory hosting and
      // the litesvm moderation authority standing in for the marketplace-
      // managed attestor (same CLEAN record_task_moderation instruction).
      const hosting = createMemoryJobSpecStore({
        publicBaseUrl: "https://store.example.com/api/agenc/job-specs",
      });
      const handler = createActivateJobSpecHandler({
        storeJobSpec: hosting.storeJobSpec,
        attestTaskModeration: async (input) => {
          const sent = await market.moderator.attestTask(
            address(input.taskPda),
            values.hexToBytes(input.jobSpecHashHex),
          );
          // P1.2: name whoever just signed the record (what the deployed
          // marketplace-managed attestor returns in its response).
          return {
            attested: true,
            moderator: String(market.moderator.address),
            txSignature: sent.signature,
          };
        },
        // The deployed route verifies the task exists before hosting or
        // attesting anything (createRpcTaskVerifier); here the same seam is
        // wired straight to the litesvm ledger.
        verifyTask: async (pda) => {
          const account = market.svm.getAccount(address(pda));
          return account?.exists
            ? { ok: true }
            : { ok: false, reason: "task not found on-chain" };
        },
      });
      // Browser half: the exact host the templates hand to
      // useHumanlessHireFlow, with fetch routed straight into the handler.
      const host = createStoreActivationHost({
        endpoint: "https://store.example.com/api/agenc/activate-job-spec",
        fetch: (async (url: RequestInfo | URL, init?: RequestInit) =>
          handler(new Request(url, init))) as typeof fetch,
      });

      const moderation = await host({
        taskPda: String(taskPda),
        taskId,
        listing: String(listingPda),
        jobSpec: buildListingJobSpec({
          listingName: "Lifecycle Analyst",
          specUri: "https://store.example.com/spec",
          brief: "Turn my CSV into a weekly report.",
        }),
        hireSignature: "test-hire-signature",
        referrerInjected: true,
      });
      expect(moderation.moderationAttested).toBe(true);
      expect(moderation.jobSpecHash).toHaveLength(32);
      // P1.2: the host surfaces the moderator whose record the activation
      // consumes — exactly the signer of the attestation above.
      expect(moderation.moderator).toBe(String(market.moderator.address));
      expect(moderation.jobSpecUri).toMatch(
        /^https:\/\/store\.example\.com\/api\/agenc\/job-specs\/[0-9a-f]{64}$/,
      );
      expect(moderation.jobSpecUri.length).toBeLessThanOrEqual(256);
      // The hosted canonical JSON hashes to the pinned hash (verifiability).
      const hostedJson = hosting.hosted.get(
        values.bytesToHex(moderation.jobSpecHash),
      );
      expect(hostedJson).toBeDefined();
      const recomputed = await values.canonicalJobSpecHash(
        JSON.parse(hostedJson!),
      );
      expect(recomputed.hex).toBe(values.bytesToHex(moderation.jobSpecHash));

      // The buyer signs the activation — the flow's final leg — naming the
      // moderator the host returned (the P1.2 record the gate consumes).
      await buyerClient.setTaskJobSpec({
        task: taskPda,
        creator: buyer,
        jobSpecHash: moderation.jobSpecHash,
        jobSpecUri: moderation.jobSpecUri,
        moderator: address(moderation.moderator),
      });

      // ---- 4) The worker can NOW claim (job spec pinned), then submits ----
      await providerClient.claimTaskWithJobSpec({
        task: taskPda,
        worker: providerAgent,
        authority: provider,
        jobSpecHash: moderation.jobSpecHash,
      });
      await providerClient.submitTaskResult({
        task: taskPda,
        worker: providerAgent,
        authority: provider,
        proofHash: new Uint8Array(32).fill(5),
        resultData: new Uint8Array(64).fill(6),
      });

      // ---- 5) Buyer review-accepts → 4-way settlement ---------------------
      const operatorBefore = market.svm.getBalance(operatorWallet) ?? 0n;
      const referrerBefore = market.svm.getBalance(referrerWallet) ?? 0n;
      const workerBefore = market.svm.getBalance(provider.address) ?? 0n;

      await buyerClient.acceptTaskResult({
        task: taskPda,
        worker: providerAgent,
        creator: buyer,
        treasury: market.admin.address,
        workerAuthority: provider.address,
        operator: operatorWallet,
        referrer: referrerWallet,
      });

      const expectedOperatorFee =
        (PRICE * BigInt(OPERATOR_FEE_BPS)) / 10_000n;
      const expectedReferrerFee =
        (PRICE * BigInt(REFERRER_FEE_BPS)) / 10_000n;
      expect(
        (market.svm.getBalance(operatorWallet) ?? 0n) - operatorBefore,
      ).toBe(expectedOperatorFee);
      expect(
        (market.svm.getBalance(referrerWallet) ?? 0n) - referrerBefore,
      ).toBe(expectedReferrerFee);
      expect(
        (market.svm.getBalance(provider.address) ?? 0n) - workerBefore,
      ).toBeGreaterThan(0n);
      // Escrow closed on settlement.
      expect(market.svm.getAccount(escrowPda)?.exists).toBe(false);
    },
  );

  it(
    "the activation route refuses a task PDA that does not exist on-chain",
    { timeout: 120_000 },
    async () => {
      const hosting = createMemoryJobSpecStore({
        publicBaseUrl: "https://store.example.com/api/agenc/job-specs",
      });
      let attestorCalled = false;
      const handler = createActivateJobSpecHandler({
        storeJobSpec: hosting.storeJobSpec,
        attestTaskModeration: async () => {
          attestorCalled = true;
          return { attested: true };
        },
        verifyTask: async (pda) => {
          const account = market.svm.getAccount(address(pda));
          return account?.exists
            ? { ok: true }
            : { ok: false, reason: "task not found on-chain" };
        },
      });
      const host = createStoreActivationHost({
        endpoint: "https://store.example.com/api/agenc/activate-job-spec",
        fetch: (async (url: RequestInfo | URL, init?: RequestInit) =>
          handler(new Request(url, init))) as typeof fetch,
      });
      // A never-hired (shape-valid) PDA: derive one from an unused task id.
      const [ghostTask] = await findTaskPda({
        creator: buyer.address,
        taskId: new Uint8Array(32).fill(99),
      });
      await expect(
        host({
          taskPda: String(ghostTask),
          taskId: new Uint8Array(32).fill(99),
          listing: String(listingPda),
          jobSpec: buildListingJobSpec({ listingName: "Ghost" }),
          hireSignature: "sig",
          referrerInjected: false,
        }),
      ).rejects.toThrow(/Task verification failed/i);
      // Fail-closed BEFORE side effects: nothing hosted, nothing attested.
      expect(hosting.hosted.size).toBe(0);
      expect(attestorCalled).toBe(false);
    },
  );

  it(
    "refuses to sign activation when the attestor does NOT attest (fail-closed)",
    { timeout: 120_000 },
    async () => {
      const hosting = createMemoryJobSpecStore({
        publicBaseUrl: "https://store.example.com/api/agenc/job-specs",
      });
      const handler = createActivateJobSpecHandler({
        storeJobSpec: hosting.storeJobSpec,
        attestTaskModeration: async () => ({
          attested: false,
          moderation: { reason: "flagged" },
        }),
      });
      const host = createStoreActivationHost({
        endpoint: "https://store.example.com/api/agenc/activate-job-spec",
        fetch: (async (url: RequestInfo | URL, init?: RequestInit) =>
          handler(new Request(url, init))) as typeof fetch,
      });
      await expect(
        host({
          taskPda: String(listingPda), // any base58 PDA shape works here
          taskId: new Uint8Array(32).fill(1),
          listing: String(listingPda),
          jobSpec: buildListingJobSpec({ listingName: "X" }),
          hireSignature: "sig",
          referrerInjected: false,
        }),
      ).rejects.toThrow(/did not attest/i);
    },
  );
});
