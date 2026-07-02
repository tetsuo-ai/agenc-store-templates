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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A fetch stub for the activation route: fails `failures` times, then 200s. */
function stubActivationRoute(failures: number): {
  calls: () => number;
} {
  let count = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      count += 1;
      if (count <= failures) {
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
          moderation: { status: "CLEAN" },
        }),
      };
    }),
  );
  return { calls: () => count };
}

function makeHarness() {
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
    };
    expect(String(activationArgs.task)).toBe(pda);
    expect(activationArgs.jobSpecUri).toContain(HASH_HEX);
    // …and NO second hire was built or sent (a fresh taskId = a second escrow).
    expect(h.hireFromListingHumanless).toHaveBeenCalledTimes(1);
    expect(h.buildHireInput).toHaveBeenCalledTimes(1);
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
});
