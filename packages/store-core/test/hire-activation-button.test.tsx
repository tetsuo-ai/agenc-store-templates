// @vitest-environment jsdom
/**
 * Rendered money-safety regression test for `<HireActivationButton>` (the
 * WP-B1 review BLOCKER). Against the pre-fix component this suite FAILS:
 *
 * 1. the pre-fix `onHired` only fired after the FULL flow resolved, so an
 *    activation failure never recorded the funded task (invisible stranded
 *    escrow);
 * 2. the pre-fix Confirm-after-error path called `buildHireInput` again with
 *    a FRESH random taskId — `hireFromListingHumanless` a SECOND time — i.e.
 *    every retry minted another full-price escrow that failed activation the
 *    same way.
 *
 * Here the real component tree renders under a real `<AgencProvider>` with a
 * mock write client + a stubbed activation route: hire lands, activation
 * fails, and the assertions pin (a) the task PDA was reported the moment the
 * hire landed, (b) EVERY retry surface (modal Confirm and the inline repair
 * panel) re-runs ONLY the activation legs against the SAME task PDA — the
 * hire mutation runs exactly once per funded task.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { address } from "@solana/kit";
import { findTaskPda } from "@tetsuo-ai/marketplace-sdk";
import { AgencProvider } from "@tetsuo-ai/marketplace-react";
import type { AgencProviderConfig } from "@tetsuo-ai/marketplace-react";
import { HireActivationButton } from "../src/sections/HireActivationButton.js";
import type { HireLandedContext } from "../src/sections/HireActivationButton.js";

const BUYER = "8iC21EoERDWSXRc5AH8fQBaV32pMSsAN3P7jumi15pH6";
const LISTING = "7RkbpXC7sPVNYSLVkaxChHgXNa4J8B4kgBhzRZzjTkHc";
const HASH_HEX = "ab".repeat(32);
/** The P1.2 moderator the stubbed store route names. */
const MODERATOR = "13tuj7ELwtHmeR22kvaSaa2pKqSscyoHtQBF65aHuo6v";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * A fetch stub for the store's activation route:
 * - `GET` (the P1.2 hire-moderator info leg) always serves `{ moderator }`
 *   (or 502s when `moderatorLookupFails`);
 * - `POST` (host+attest) fails `failures` times, then 200s — with the
 *   moderator named unless `omitModerator` (an outdated store route);
 * - anything else (kit RPC traffic from the hooks' moderation-account
 *   resolvers) gets a JSON-RPC error so the resolvers fail soft.
 */
function stubActivationRoute(
  failures: number,
  options: { omitModerator?: boolean; moderatorLookupFails?: boolean } = {},
): {
  calls: () => number;
} {
  let posts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      if (!href.includes("/api/agenc/activate-job-spec")) {
        // Kit RPC traffic — not the activation route.
        return {
          ok: true,
          status: 200,
          json: async () => ({
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32601, message: "rpc stubbed out" },
          }),
        };
      }
      if ((init?.method ?? "GET") === "GET") {
        if (options.moderatorLookupFails) {
          return {
            ok: false,
            status: 502,
            json: async () => ({ error: "attestor /v1/info unreachable" }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ moderator: MODERATOR }),
        };
      }
      posts += 1;
      if (posts <= failures) {
        return {
          ok: false,
          status: 502,
          json: async () => ({ error: "attestor down" }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jobSpecHashHex: HASH_HEX,
          jobSpecUri: `https://store.example.com/api/agenc/job-specs/${HASH_HEX}`,
          moderationAttested: true,
          ...(options.omitModerator ? {} : { moderator: MODERATOR }),
          moderation: { status: "CLEAN" },
        }),
      };
    }),
  );
  return { calls: () => posts };
}

let harnessCount = 0;

function makeHarness() {
  // Unique per harness: fetchStoreHireModerator caches per endpoint for the
  // whole session (module scope), so tests must not share one.
  const activationEndpoint = `/api/agenc/activate-job-spec?h=${++harnessCount}`;
  const signer = { address: address(BUYER) };
  const hireFromListingHumanless = vi.fn(
    async (..._args: unknown[]) => ({ signature: "hire-sig" }),
  );
  const setTaskJobSpec = vi.fn(async (..._args: unknown[]) => ({
    signature: "activation-sig",
  }));
  const client = {
    signer,
    hireFromListingHumanless,
    setTaskJobSpec,
  };
  const taskId = new Uint8Array(32).fill(21);
  const listing = {
    address: LISTING,
    account: {
      price: 5_000_000n,
      version: 1n,
      specHash: new Uint8Array(32).fill(7),
      name: new TextEncoder().encode("Test Analyst"),
      specUri: "https://store.example.com/spec",
    },
  };
  const buildHireInput = vi.fn(() => ({
    listing: LISTING,
    taskId,
    expectedPrice: 5_000_000n,
    expectedVersion: 1n,
    listingSpecHash: new Uint8Array(32).fill(7),
    reviewWindowSecs: 3600,
  }));
  const onHired = vi.fn<(taskPda: string, ctx: HireLandedContext) => void>();
  const onActivated = vi.fn<(result: unknown) => void>();
  const config = {
    network: "localnet",
    client,
    signer,
    // Reads never run in this suite; a stub transport satisfies the provider.
    queryTransport: {},
  } as unknown as AgencProviderConfig;

  const ui = (
    <AgencProvider config={config}>
      <HireActivationButton
        listing={listing as never}
        buildHireInput={buildHireInput as never}
        activationEndpoint={activationEndpoint}
        onHired={onHired}
        onActivated={onActivated}
      />
    </AgencProvider>
  );
  return {
    ui,
    taskId,
    hireFromListingHumanless,
    setTaskJobSpec,
    buildHireInput,
    onHired,
    onActivated,
  };
}

async function expectedTaskPda(taskId: Uint8Array): Promise<string> {
  const [pda] = await findTaskPda({ creator: address(BUYER), taskId });
  return String(pda);
}

async function openAndConfirm(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /^Hire/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: /confirm and fund escrow/i }),
  );
}

describe("HireActivationButton money safety (rendered)", () => {
  it("reports the funded task the moment the hire lands, even when activation fails", async () => {
    const h = makeHarness();
    stubActivationRoute(Number.POSITIVE_INFINITY);
    render(h.ui);
    await openAndConfirm();

    // The hire landed and activation failed → the error surfaces...
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(h.hireFromListingHumanless).toHaveBeenCalledTimes(1);
    // ...but the funded task was ALREADY reported with its repair context.
    const pda = await expectedTaskPda(h.taskId);
    expect(h.onHired).toHaveBeenCalledTimes(1);
    expect(h.onHired.mock.calls[0]![0]).toBe(pda);
    const context = h.onHired.mock.calls[0]![1];
    expect(context.listing).toBe(LISTING);
    expect(context.taskIdHex).toBe("15".repeat(32)); // 0x15 = 21
    expect(context.hireSignature).toBe("hire-sig");
    expect(context.jobSpec?.title).toContain("Test Analyst");
    expect(h.onActivated).not.toHaveBeenCalled();
  });

  it("Confirm after a failed activation retries ONLY activation — never a second hire", async () => {
    const h = makeHarness();
    const route = stubActivationRoute(1); // first activation POST fails, then heals
    render(h.ui);
    await openAndConfirm();
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(h.hireFromListingHumanless).toHaveBeenCalledTimes(1);
    expect(route.calls()).toBe(1);

    // The surfaced error tells the buyer a retry will NOT charge again.
    expect(screen.getByRole("alert").textContent).toMatch(/will not charge again/i);

    // Retry via the modal's Confirm.
    fireEvent.click(
      screen.getByRole("button", { name: /confirm and fund escrow/i }),
    );

    await waitFor(() => expect(h.onActivated).toHaveBeenCalledTimes(1));
    const pda = await expectedTaskPda(h.taskId);
    // The activation was re-driven against the EXISTING task…
    expect(route.calls()).toBe(2);
    expect(h.setTaskJobSpec).toHaveBeenCalledTimes(1);
    const activationArgs = h.setTaskJobSpec.mock.calls[0]![0] as unknown as {
      task: unknown;
      jobSpecUri: string;
      moderator: unknown;
    };
    expect(String(activationArgs.task)).toBe(pda);
    expect(activationArgs.jobSpecUri).toContain(HASH_HEX);
    // …naming the P1.2 moderator whose attestation record it consumes…
    expect(String(activationArgs.moderator)).toBe(MODERATOR);
    // …and NO second hire was built or sent (a fresh taskId = a second escrow).
    expect(h.hireFromListingHumanless).toHaveBeenCalledTimes(1);
    expect(h.buildHireInput).toHaveBeenCalledTimes(1);
    // The hire itself named the auto-resolved P1.2 moderator (the hire gate
    // consumes that moderator's LISTING attestation).
    const hireArgs = h.hireFromListingHumanless.mock.calls[0]![0] as {
      moderator: unknown;
    };
    expect(String(hireArgs.moderator)).toBe(MODERATOR);
    expect(h.onActivated.mock.calls[0]![0]).toMatchObject({
      activationSignature: "activation-sig",
    });
  });

  it("closing the modal keeps an inline Retry-activation panel that repairs without re-hiring", async () => {
    const h = makeHarness();
    const route = stubActivationRoute(1);
    render(h.ui);
    await openAndConfirm();
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    // Close the modal — the stranded hire must stay repairable on the page.
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    const retryButton = await screen.findByRole("button", {
      name: /retry activation/i,
    });
    fireEvent.click(retryButton);

    await waitFor(() => expect(h.onActivated).toHaveBeenCalledTimes(1));
    expect(route.calls()).toBe(2);
    expect(h.setTaskJobSpec).toHaveBeenCalledTimes(1);
    expect(h.hireFromListingHumanless).toHaveBeenCalledTimes(1);
    // Nothing is stranded anymore: the repair panel unmounts.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /retry activation/i }),
      ).toBeNull(),
    );
  });

  it("aborts BEFORE the hire when the P1.2 moderator cannot be resolved (no escrow funded)", async () => {
    const h = makeHarness();
    stubActivationRoute(0, { moderatorLookupFails: true });
    render(h.ui);
    await openAndConfirm();

    // The moderator lookup failure surfaces…
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/unreachable/i);
    // …and NO money ever moved: the hire was never sent.
    expect(h.hireFromListingHumanless).not.toHaveBeenCalled();
    expect(h.setTaskJobSpec).not.toHaveBeenCalled();
    expect(h.onHired).not.toHaveBeenCalled();
  });

  it("refuses to sign activation when the route names no moderator (fail-closed), keeping the funded task repairable", async () => {
    const h = makeHarness();
    stubActivationRoute(0, { omitModerator: true }); // an outdated store route
    render(h.ui);
    await openAndConfirm();

    // The hire landed, but the moderator-less moderation result is refused…
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/moderator/i);
    expect(h.hireFromListingHumanless).toHaveBeenCalledTimes(1);
    // …the activation was never signed…
    expect(h.setTaskJobSpec).not.toHaveBeenCalled();
    // …and the funded task was still reported for the repair path.
    expect(h.onHired).toHaveBeenCalledTimes(1);
    expect(h.onActivated).not.toHaveBeenCalled();
  });
});

/**
 * §12 roster-trust rail — END-TO-END integration (review finding F1): the
 * REAL button drives the REAL activation route handler wired with the REAL
 * listing-trust resolver over a fake RPC. The store's own attestor holds NO
 * record for this listing; a FOREIGN roster attestor's on-chain record is
 * the only consumable one. The hire must name the FOREIGN moderator.
 *
 * Revert-sensitive both ways:
 * - unwire the button (drop `listing` from fetchStoreHireModerator) → the
 *   GET loses `?listing=` → the route answers listing-agnostically with the
 *   store's own moderator → the FOREIGN assertion goes red;
 * - unwire the route (drop `resolveListingHireModeration` from the handler)
 *   → same red.
 */
describe("roster-trust rail end to end (button → route → resolver)", () => {
  it("a cross-node hire names the FOREIGN roster attestor whose record actually exists", async () => {
    const [
      { createActivateJobSpecHandler, createMemoryJobSpecStore },
      listingTrust,
      sdk,
      kit,
    ] = await Promise.all([
      import("../src/activation/server.js"),
      import("../src/activation/listing-trust.js"),
      import("@tetsuo-ai/marketplace-sdk"),
      import("@solana/kit"),
    ]);
    const FOREIGN = String(
      kit.getAddressDecoder().decode(new Uint8Array(32).fill(77)),
    );
    const SPEC_HASH = new Uint8Array(32).fill(7); // = the harness listing's specHash
    const listingAccount = Uint8Array.from(
      sdk.getServiceListingEncoder().encode({
        providerAgent: String(
          kit.getAddressDecoder().decode(new Uint8Array(32).fill(2)),
        ) as never,
        authority: String(
          kit.getAddressDecoder().decode(new Uint8Array(32).fill(3)),
        ) as never,
        listingId: new Uint8Array(32),
        name: new Uint8Array(64),
        category: new Uint8Array(32),
        tags: new Uint8Array(64),
        specHash: SPEC_HASH,
        specUri: "https://store.example.com/spec",
        price: 5_000_000n,
        priceMint: null,
        requiredCapabilities: 0n,
        defaultDeadlineSecs: 0n,
        operator: String(
          kit.getAddressDecoder().decode(new Uint8Array(32)),
        ) as never,
        operatorFeeBps: 0,
        state: 0,
        maxOpenJobs: 0,
        openJobs: 0,
        totalHires: 0n,
        totalRating: 0n,
        ratingCount: 0,
        version: 1n,
        createdAt: 1n,
        updatedAt: 1n,
        bump: 250,
        reserved: new Uint8Array(64),
      }),
    );
    const [foreignRecordPda] = await sdk.findListingModerationPda({
      listing: LISTING as never,
      jobSpecHash: SPEC_HASH,
      moderator: FOREIGN as never,
    });
    const foreignRecord = Uint8Array.from(
      sdk.getListingModerationEncoder().encode({
        listing: LISTING as never,
        providerAgent: String(
          kit.getAddressDecoder().decode(new Uint8Array(32).fill(2)),
        ) as never,
        jobSpecHash: SPEC_HASH,
        status: 0,
        riskScore: 0,
        categoryMask: 0n,
        policyHash: new Uint8Array(32),
        scannerHash: new Uint8Array(32),
        recordedAt: 1n,
        expiresAt: 0n,
        moderator: FOREIGN as never,
        bump: 254,
        reserved: new Uint8Array(64),
      }),
    );
    const accounts = new Map<string, Uint8Array>([
      [LISTING, listingAccount],
      [String(foreignRecordPda), foreignRecord],
    ]);
    const rpcAccount = (data: Uint8Array) => ({
      data: [Buffer.from(data).toString("base64"), "base64"] as const,
      executable: false,
      lamports: 1_000_000n,
      owner: sdk.AGENC_COORDINATION_PROGRAM_ADDRESS,
      rentEpoch: 0n,
      space: BigInt(data.length),
    });
    const fakeRpc = {
      getAccountInfo: (addr: unknown) => ({
        send: async () => {
          const data = accounts.get(String(addr));
          return { context: { slot: 0n }, value: data ? rpcAccount(data) : null };
        },
      }),
      getMultipleAccounts: (addrs: readonly unknown[]) => ({
        send: async () => ({
          context: { slot: 0n },
          value: addrs.map((a) => {
            const data = accounts.get(String(a));
            return data ? rpcAccount(data) : null;
          }),
        }),
      }),
      getProgramAccounts: () => ({
        send: async () => ({ context: { slot: 0n }, value: [] }),
      }),
    } as never;

    const resolver = listingTrust.createListingHireModerationResolver({
      rpcUrl: "http://fake.invalid",
      trustPolicy: "any-bonded-attestor",
      resolveStoreModerators: async () => [MODERATOR], // own attestor: NO record
      attestorEndpoint: null, // discovery-only — the record must be FOUND
      rpc: fakeRpc,
      roster: { active: [FOREIGN], exiting: new Set<string>() },
      moderationConfig: {
        exists: true,
        moderationAuthority: null,
        enabled: true,
        updatedAt: BigInt(Math.floor(Date.now() / 1000)),
        livenessWindowSecs: 0,
      },
    });
    const hosting = createMemoryJobSpecStore({
      publicBaseUrl: "http://store.local/api/agenc/job-specs",
    });
    // The template-shaped route: the handler wired exactly like
    // templates/*/src/app/api/agenc/activate-job-spec/route.ts.
    const routeHandler = createActivateJobSpecHandler({
      storeJobSpec: hosting.storeJobSpec,
      attestTaskModeration: async () => ({
        attested: true,
        moderator: MODERATOR,
        moderation: { status: "CLEAN" },
      }),
      resolveHireModerator: async () => MODERATOR,
      resolveListingHireModeration: resolver,
      rateLimit: false,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const href = String(url);
        if (!href.includes("/api/agenc/activate-job-spec")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              jsonrpc: "2.0",
              id: 1,
              error: { code: -32601, message: "rpc stubbed out" },
            }),
          } as never;
        }
        const absolute = href.startsWith("http")
          ? href
          : `http://store.local${href}`;
        return routeHandler(new Request(absolute, init));
      }),
    );

    const h = makeHarness();
    render(h.ui);
    await openAndConfirm();
    await waitFor(() => expect(h.onActivated).toHaveBeenCalledTimes(1));

    // THE rail assertion: the hire named the FOREIGN attestor whose record
    // actually exists — not the store's own listing-agnostic moderator.
    const hireArgs = h.hireFromListingHumanless.mock.calls[0]![0] as {
      moderator: unknown;
    };
    expect(String(hireArgs.moderator)).toBe(FOREIGN);
    expect(String(hireArgs.moderator)).not.toBe(MODERATOR);
  });
});
