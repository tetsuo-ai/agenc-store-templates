/**
 * Unit tests for the §12 roster-trust consumption rail
 * (`activation/listing-trust`): trust-policy resolution, strict roster
 * scanning (discriminator filter, exit filtering, the MAX_ROSTER_ATTESTORS
 * bound, decode strictness), gate-mirroring record validity, discovery order
 * and fall-through, acquisition trigger conditions, and the end-to-end
 * resolver's fail-closed discipline.
 *
 * All on-chain state is faked at the RPC boundary with REAL sdk account
 * encoders (the same bytes a cluster would return), so the tests exercise
 * the real decode paths.
 *
 * NOTE: this file deliberately imports the module under test as a NAMESPACE
 * (`listingTrust.*`) and nothing from `activation/server.ts`, so the whole
 * suite still loads against the pre-audit WIP revision of the module — that
 * is what makes the revert-sensitivity check meaningful (key tests here go
 * RED against the unaudited logic instead of dying on a missing import).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { getAddressDecoder, getBase58Decoder } from "@solana/kit";
import {
  AGENC_COORDINATION_PROGRAM_ADDRESS,
  facade,
  findListingModerationPda,
  getListingModerationEncoder,
  getModerationAttestorEncoder,
  getServiceListingEncoder,
  MODERATION_ATTESTOR_DISCRIMINATOR,
} from "@tetsuo-ai/marketplace-sdk";
import * as listingTrust from "../src/activation/listing-trust.js";

// ------------------------------------------------------------------ fixtures

/** Deterministic 32-byte address (base58) from a fill byte. */
function addrOf(n: number): string {
  return String(getAddressDecoder().decode(new Uint8Array(32).fill(n)));
}

const LISTING = addrOf(50);
const MOD_OWN = addrOf(11); // the store's own attestor
const MOD_FOREIGN = addrOf(12); // another node's roster attestor
const MOD_EXITING = addrOf(13);
const SPEC_HASH = new Uint8Array(32).fill(9);
const SPEC_HASH_HEX = "09".repeat(32);
const SPEC_URI = "https://specs.example.com/analyst.json";
const NOW = 1_800_000_000; // fixed test clock (seconds)

function encodeAttestor(input: { attestor: string; exitAt?: bigint }): Uint8Array {
  return Uint8Array.from(
    getModerationAttestorEncoder().encode({
      attestor: input.attestor as never,
      assignedBy: input.attestor as never,
      assignedAt: 1n,
      bump: 255,
      bondLamports: 1_000_000n,
      registeredAt: 1n,
      exitAt: input.exitAt ?? 0n,
      reserved: new Uint8Array(8),
    }),
  );
}

function encodeModeration(input: {
  moderator: string;
  status?: number;
  riskScore?: number;
  expiresAt?: bigint;
}): Uint8Array {
  return Uint8Array.from(
    getListingModerationEncoder().encode({
      listing: LISTING as never,
      providerAgent: addrOf(2) as never,
      jobSpecHash: SPEC_HASH,
      status: input.status ?? 0,
      riskScore: input.riskScore ?? 0,
      categoryMask: 0n,
      policyHash: new Uint8Array(32),
      scannerHash: new Uint8Array(32),
      recordedAt: 1n,
      expiresAt: input.expiresAt ?? 0n,
      moderator: input.moderator as never,
      bump: 254,
      reserved: new Uint8Array(64),
    }),
  );
}

function encodeListing(specUri = SPEC_URI): Uint8Array {
  return Uint8Array.from(
    getServiceListingEncoder().encode({
      providerAgent: addrOf(2) as never,
      authority: addrOf(3) as never,
      listingId: new Uint8Array(32),
      name: new Uint8Array(64),
      category: new Uint8Array(32),
      tags: new Uint8Array(64),
      specHash: SPEC_HASH,
      specUri,
      price: 1_000n,
      priceMint: null,
      requiredCapabilities: 0n,
      defaultDeadlineSecs: 0n,
      operator: addrOf(0) as never,
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
}

async function moderationPdaOf(moderator: string): Promise<string> {
  const [pda] = await findListingModerationPda({
    listing: LISTING as never,
    jobSpecHash: SPEC_HASH,
    moderator: moderator as never,
  });
  return String(pda);
}

async function legacyPda(): Promise<string> {
  const [pda] = await facade.findLegacyListingModerationPda({
    listing: LISTING as never,
    jobSpecHash: SPEC_HASH,
  });
  return String(pda);
}

function rpcAccount(data: Uint8Array) {
  return {
    data: [Buffer.from(data).toString("base64"), "base64"] as const,
    executable: false,
    lamports: 1_000_000n,
    owner: AGENC_COORDINATION_PROGRAM_ADDRESS,
    rentEpoch: 0n,
    space: BigInt(data.length),
  };
}

/**
 * Fake at the raw RPC boundary: `getAccountInfo` / `getMultipleAccounts`
 * serve base64 accounts out of `accounts` (address → encoded data);
 * `getProgramAccounts` serves the roster. `failModerationReads` makes every
 * account read EXCEPT the listing itself throw — the "transient RPC error
 * mid-discovery" seam.
 */
function fakeRpc(opts: {
  accounts?: Map<string, Uint8Array>;
  roster?: Uint8Array[] | (() => Uint8Array[]);
  failModerationReads?: boolean;
  onProgramAccounts?: (program: string, config: unknown) => void;
}) {
  const state = { gpaCalls: 0 };
  const readable = (addr: string) =>
    !opts.failModerationReads || addr === LISTING;
  const rpc = {
    state,
    getAccountInfo(addr: unknown) {
      return {
        send: async () => {
          if (!readable(String(addr))) {
            throw new Error("rpc transiently unavailable (getAccountInfo)");
          }
          const data = opts.accounts?.get(String(addr));
          return { context: { slot: 0n }, value: data ? rpcAccount(data) : null };
        },
      };
    },
    getMultipleAccounts(addrs: readonly unknown[]) {
      return {
        send: async () => {
          if (opts.failModerationReads) {
            throw new Error("rpc transiently unavailable (getMultipleAccounts)");
          }
          return {
            context: { slot: 0n },
            value: addrs.map((a) => {
              const data = opts.accounts?.get(String(a));
              return data ? rpcAccount(data) : null;
            }),
          };
        },
      };
    },
    getProgramAccounts(program: string, config: unknown) {
      return {
        send: async () => {
          state.gpaCalls += 1;
          opts.onProgramAccounts?.(program, config);
          const datas =
            typeof opts.roster === "function" ? opts.roster() : (opts.roster ?? []);
          return {
            context: { slot: 0n },
            value: datas.map((d, i) => ({
              pubkey: addrOf(200 + (i % 55)),
              account: rpcAccount(d),
            })),
          };
        },
      };
    },
  };
  return rpc as never as listingTrust.ListingReadRpc &
    listingTrust.RosterScanRpc & { state: { gpaCalls: number } };
}

/**
 * Fake attestation service for the acquisition POST
 * (`requestListingModeration`'s fetch seam). `onRecord` runs on each CLEAN
 * call — the seam that "lands" the on-chain record into the fake rpc.
 */
function fakeModerationService(opts: {
  verdict?: "clean" | "suspicious" | "blocked";
  specHashHex?: string;
  attestation?: boolean;
  onRecord?: () => void | Promise<void>;
}) {
  const calls: { count: number; urls: string[] } = { count: 0, urls: [] };
  const verdict = opts.verdict ?? "clean";
  const fetchImpl = (async (url: unknown) => {
    calls.count += 1;
    calls.urls.push(String(url));
    if (verdict === "clean" && (opts.attestation ?? true)) {
      await opts.onRecord?.();
    }
    return new Response(
      JSON.stringify({
        verdict,
        riskScore: verdict === "clean" ? 0 : 90,
        specHash: opts.specHashHex ?? SPEC_HASH_HEX,
        attestation:
          verdict === "clean" && (opts.attestation ?? true)
            ? { signature: "sig", recordedAt: "2026-07-04T00:00:00Z" }
            : null,
        policyHash: "00".repeat(32),
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  return { fetchImpl, calls };
}

beforeEach(() => {
  listingTrust.__clearListingTrustCachesForTests();
});

// -------------------------------------------------------- policy resolution

describe("resolveListingTrustPolicy", () => {
  it("defaults to edge-list (nothing changes until the operator opts in)", () => {
    expect(listingTrust.resolveListingTrustPolicy(undefined, {})).toBe(
      "edge-list",
    );
  });

  it("explicit config wins, both values", () => {
    expect(
      listingTrust.resolveListingTrustPolicy("any-bonded-attestor", {}),
    ).toBe("any-bonded-attestor");
    expect(
      listingTrust.resolveListingTrustPolicy("edge-list", {
        AGENC_MODERATION_TRUST: "any-bonded-attestor",
      }),
    ).toBe("edge-list");
  });

  it("honors the deploy env fallback with the exact value only", () => {
    expect(
      listingTrust.resolveListingTrustPolicy(undefined, {
        AGENC_MODERATION_TRUST: "any-bonded-attestor",
      }),
    ).toBe("any-bonded-attestor");
    expect(
      listingTrust.resolveListingTrustPolicy(undefined, {
        AGENC_MODERATION_TRUST: " any-bonded-attestor ",
      }),
    ).toBe("any-bonded-attestor");
    expect(
      listingTrust.resolveListingTrustPolicy(undefined, {
        AGENC_MODERATION_TRUST: "yes-please",
      }),
    ).toBe("edge-list");
  });
});

// ------------------------------------------------------------- roster scan

describe("fetchRosterAttestors (strict roster scan)", () => {
  it("filters by the ModerationAttestor discriminator on the coordination program and decodes exit state", async () => {
    let seenProgram = "";
    let seenConfig: unknown;
    const rpc = fakeRpc({
      roster: [
        encodeAttestor({ attestor: MOD_FOREIGN }),
        encodeAttestor({ attestor: MOD_EXITING, exitAt: 1_700_000_000n }),
      ],
      onProgramAccounts: (program, config) => {
        seenProgram = program;
        seenConfig = config;
      },
    });
    const entries = await listingTrust.fetchRosterAttestors(rpc);
    expect(entries).toEqual([
      { attestor: MOD_FOREIGN, exiting: false },
      { attestor: MOD_EXITING, exiting: true },
    ]);
    expect(seenProgram).toBe(String(AGENC_COORDINATION_PROGRAM_ADDRESS));
    const expected58 = getBase58Decoder().decode(
      Uint8Array.from(Array.from(MODERATION_ATTESTOR_DISCRIMINATOR)),
    );
    expect(seenConfig).toMatchObject({
      encoding: "base64",
      filters: [{ memcmp: { offset: 0n, bytes: expected58 } }],
    });
  });

  it("THROWS over the MAX_ROSTER_ATTESTORS bound — never silently truncates", async () => {
    const over = Array.from(
      { length: listingTrust.MAX_ROSTER_ATTESTORS + 1 },
      (_, i) => encodeAttestor({ attestor: addrOf(1 + (i % 250)) }),
    );
    const rpc = fakeRpc({ roster: over });
    await expect(listingTrust.fetchRosterAttestors(rpc)).rejects.toThrow(
      /MAX_ROSTER_ATTESTORS/,
    );
  });

  it("THROWS on a discriminator-matching entry that fails to decode (layout drift ≠ skip)", async () => {
    const rpc = fakeRpc({
      roster: [
        encodeAttestor({ attestor: MOD_FOREIGN }),
        Uint8Array.from(Array.from(MODERATION_ATTESTOR_DISCRIMINATOR)), // truncated body
      ],
    });
    await expect(listingTrust.fetchRosterAttestors(rpc)).rejects.toThrow(
      /failed to decode/i,
    );
  });
});

describe("bondedRosterModerators (short-TTL cache)", () => {
  it("caches per rpc identity and the test seam drops it", async () => {
    const rpc = fakeRpc({ roster: [encodeAttestor({ attestor: MOD_FOREIGN })] });
    const first = await listingTrust.bondedRosterModerators(rpc);
    await listingTrust.bondedRosterModerators(rpc);
    expect(first.active).toEqual([MOD_FOREIGN]);
    expect(rpc.state.gpaCalls).toBe(1);
    listingTrust.__clearListingTrustCachesForTests();
    await listingTrust.bondedRosterModerators(rpc);
    expect(rpc.state.gpaCalls).toBe(2);
  });

  it("does NOT serve one cluster's roster snapshot to a different rpc", async () => {
    const rpcA = fakeRpc({ roster: [encodeAttestor({ attestor: MOD_FOREIGN })] });
    const rpcB = fakeRpc({ roster: [encodeAttestor({ attestor: MOD_EXITING })] });
    expect((await listingTrust.bondedRosterModerators(rpcA)).active).toEqual([
      MOD_FOREIGN,
    ]);
    expect((await listingTrust.bondedRosterModerators(rpcB)).active).toEqual([
      MOD_EXITING,
    ]);
    expect(rpcB.state.gpaCalls).toBe(1);
  });
});

describe("trustedListingModerators (policy → candidate list)", () => {
  it("edge-list: exactly the store's own moderators, deduped, and NO roster read", async () => {
    const rpc = fakeRpc({
      roster: () => {
        throw new Error("roster must not be scanned under edge-list");
      },
    });
    await expect(
      listingTrust.trustedListingModerators({
        rpc,
        storeModerators: [MOD_OWN, MOD_OWN, ""],
        trustPolicy: "edge-list",
      }),
    ).resolves.toEqual([MOD_OWN]);
  });

  it("any-bonded-attestor: own-first order, exiting attestors excluded on BOTH legs", async () => {
    const candidates = await listingTrust.trustedListingModerators({
      rpc: fakeRpc({}),
      storeModerators: [MOD_OWN, MOD_EXITING],
      trustPolicy: "any-bonded-attestor",
      roster: {
        active: [MOD_FOREIGN, MOD_OWN],
        exiting: new Set([MOD_EXITING]),
      },
    });
    // MOD_EXITING dropped (its record reverts at the gate); MOD_OWN not
    // duplicated; roster additions come after own.
    expect(candidates).toEqual([MOD_OWN, MOD_FOREIGN]);
  });
});

// -------------------------------------------- record validity + discovery

describe("isConsumableListingModeration (mirror of validate_listing_moderation_for_hire)", () => {
  const base = { status: 0, riskScore: 0, expiresAt: 0n };
  it("accepts CLEAN and HUMAN_APPROVED, rejects every other status", () => {
    const ok = (status: number) =>
      listingTrust.isConsumableListingModeration({ ...base, status }, NOW);
    expect(ok(listingTrust.LISTING_MODERATION_STATUS.CLEAN)).toBe(true);
    expect(ok(listingTrust.LISTING_MODERATION_STATUS.HUMAN_APPROVED)).toBe(true);
    expect(ok(listingTrust.LISTING_MODERATION_STATUS.SUSPICIOUS)).toBe(false);
    expect(ok(listingTrust.LISTING_MODERATION_STATUS.BLOCKED)).toBe(false);
    expect(ok(listingTrust.LISTING_MODERATION_STATUS.SCANNER_UNAVAILABLE)).toBe(
      false,
    );
    expect(ok(listingTrust.LISTING_MODERATION_STATUS.HUMAN_REJECTED)).toBe(false);
  });

  it("enforces the risk-score bound and expiry (incl. the safety window)", () => {
    expect(
      listingTrust.isConsumableListingModeration(
        { ...base, riskScore: listingTrust.MAX_CONSUMABLE_RISK_SCORE },
        NOW,
      ),
    ).toBe(true);
    expect(
      listingTrust.isConsumableListingModeration(
        { ...base, riskScore: listingTrust.MAX_CONSUMABLE_RISK_SCORE + 1 },
        NOW,
      ),
    ).toBe(false);
    // 0 = never expires.
    expect(listingTrust.isConsumableListingModeration(base, NOW)).toBe(true);
    // Expired.
    expect(
      listingTrust.isConsumableListingModeration(
        { ...base, expiresAt: BigInt(NOW - 100) },
        NOW,
      ),
    ).toBe(false);
    // Expiring inside the safety window: would revert by signing time.
    expect(
      listingTrust.isConsumableListingModeration(
        { ...base, expiresAt: BigInt(NOW + 5) },
        NOW,
      ),
    ).toBe(false);
    // Comfortably in the future.
    expect(
      listingTrust.isConsumableListingModeration(
        { ...base, expiresAt: BigInt(NOW + 3600) },
        NOW,
      ),
    ).toBe(true);
  });
});

describe("discoverListingModerationRecord", () => {
  it("returns the first candidate's CONSUMABLE record in candidate order", async () => {
    const accounts = new Map<string, Uint8Array>([
      [await moderationPdaOf(MOD_FOREIGN), encodeModeration({ moderator: MOD_FOREIGN })],
    ]);
    const rpc = fakeRpc({ accounts });
    const found = await listingTrust.discoverListingModerationRecord(rpc, {
      listing: LISTING,
      specHashHex: SPEC_HASH_HEX,
      candidates: [MOD_OWN, MOD_FOREIGN],
      nowSeconds: NOW,
    });
    expect(found).toMatchObject({
      moderator: MOD_FOREIGN,
      legacy: false,
      status: 0,
    });
    expect(found!.recordPda).toBe(await moderationPdaOf(MOD_FOREIGN));
  });

  it("an EXPIRED record from an earlier candidate must not shadow a later valid one", async () => {
    const accounts = new Map<string, Uint8Array>([
      [
        await moderationPdaOf(MOD_OWN),
        encodeModeration({ moderator: MOD_OWN, expiresAt: BigInt(NOW - 60) }),
      ],
      [await moderationPdaOf(MOD_FOREIGN), encodeModeration({ moderator: MOD_FOREIGN })],
    ]);
    const found = await listingTrust.discoverListingModerationRecord(
      fakeRpc({ accounts }),
      {
        listing: LISTING,
        specHashHex: SPEC_HASH_HEX,
        candidates: [MOD_OWN, MOD_FOREIGN],
        nowSeconds: NOW,
      },
    );
    // The expired record EXISTS but would revert at the hire gate — it must
    // be skipped, not consumed.
    expect(found?.moderator).toBe(MOD_FOREIGN);
  });

  it("a BLOCKED-status record that merely exists is a miss (null), not a hit", async () => {
    const accounts = new Map<string, Uint8Array>([
      [
        await moderationPdaOf(MOD_OWN),
        encodeModeration({
          moderator: MOD_OWN,
          status: listingTrust.LISTING_MODERATION_STATUS.BLOCKED,
        }),
      ],
    ]);
    await expect(
      listingTrust.discoverListingModerationRecord(fakeRpc({ accounts }), {
        listing: LISTING,
        specHashHex: SPEC_HASH_HEX,
        candidates: [MOD_OWN],
        nowSeconds: NOW,
      }),
    ).resolves.toBeNull();
  });

  it("accepts a valid legacy-seeded record ONLY from a trusted moderator", async () => {
    const legacyRecord = encodeModeration({ moderator: MOD_FOREIGN });
    const accounts = new Map<string, Uint8Array>([[await legacyPda(), legacyRecord]]);
    const trusted = await listingTrust.discoverListingModerationRecord(
      fakeRpc({ accounts }),
      {
        listing: LISTING,
        specHashHex: SPEC_HASH_HEX,
        candidates: [MOD_FOREIGN],
        nowSeconds: NOW,
      },
    );
    expect(trusted).toMatchObject({ moderator: MOD_FOREIGN, legacy: true });

    const untrusted = await listingTrust.discoverListingModerationRecord(
      fakeRpc({ accounts }),
      {
        listing: LISTING,
        specHashHex: SPEC_HASH_HEX,
        candidates: [MOD_OWN], // record author not in the trusted set
        nowSeconds: NOW,
      },
    );
    expect(untrusted).toBeNull();
  });

  it("an expired LEGACY record is a miss too", async () => {
    const accounts = new Map<string, Uint8Array>([
      [
        await legacyPda(),
        encodeModeration({ moderator: MOD_OWN, expiresAt: BigInt(NOW - 60) }),
      ],
    ]);
    await expect(
      listingTrust.discoverListingModerationRecord(fakeRpc({ accounts }), {
        listing: LISTING,
        specHashHex: SPEC_HASH_HEX,
        candidates: [MOD_OWN],
        nowSeconds: NOW,
      }),
    ).resolves.toBeNull();
  });

  it("PROPAGATES a transient RPC error instead of reporting a miss", async () => {
    const rpc = fakeRpc({ failModerationReads: true });
    await expect(
      listingTrust.discoverListingModerationRecord(rpc, {
        listing: LISTING,
        specHashHex: SPEC_HASH_HEX,
        candidates: [MOD_OWN],
        nowSeconds: NOW,
      }),
    ).rejects.toThrow(/transiently unavailable/);
  });
});

// --------------------------------------------------------------- acquisition

describe("acquireListingAttestation", () => {
  it("derives the /v1/moderation/listings endpoint from the attest endpoint origin", () => {
    expect(
      listingTrust.listingsModerationUrl(
        "https://attest.agenc.ag/api/task-moderation/attest",
      ),
    ).toBe("https://attest.agenc.ag/v1/moderation/listings");
  });

  it("refuses a non-HTTP(S) spec URI without calling the service", async () => {
    const service = fakeModerationService({});
    const outcome = await listingTrust.acquireListingAttestation({
      attestorEndpoint: "https://attest.example/api/task-moderation/attest",
      listing: LISTING,
      specUri: "agenc://job-spec/sha256/abc",
      specHashHex: SPEC_HASH_HEX,
      fetch: service.fetchImpl,
    });
    expect(outcome.state).toBe("failed");
    expect(service.calls.count).toBe(0);
  });

  it("maps a blocked verdict to the blocked outcome", async () => {
    const service = fakeModerationService({ verdict: "blocked" });
    const outcome = await listingTrust.acquireListingAttestation({
      attestorEndpoint: "https://attest.example/api/task-moderation/attest",
      listing: LISTING,
      specUri: SPEC_URI,
      specHashHex: SPEC_HASH_HEX,
      fetch: service.fetchImpl,
    });
    expect(outcome).toEqual({
      state: "blocked",
      detail: expect.stringMatching(/BLOCKED/),
    });
    expect(service.calls.urls).toEqual([
      "https://attest.example/v1/moderation/listings",
    ]);
  });

  it("fails when the scanned hash no longer binds the on-chain spec_hash", async () => {
    const service = fakeModerationService({ specHashHex: "ab".repeat(32) });
    const outcome = await listingTrust.acquireListingAttestation({
      attestorEndpoint: "https://attest.example/api/task-moderation/attest",
      listing: LISTING,
      specUri: SPEC_URI,
      specHashHex: SPEC_HASH_HEX,
      fetch: service.fetchImpl,
    });
    expect(outcome.state).toBe("failed");
    expect((outcome as { detail: string }).detail).toMatch(/spec_hash/);
  });

  it("fails when the verdict is clean but no attestation was recorded", async () => {
    const service = fakeModerationService({ attestation: false });
    const outcome = await listingTrust.acquireListingAttestation({
      attestorEndpoint: "https://attest.example/api/task-moderation/attest",
      listing: LISTING,
      specUri: SPEC_URI,
      specHashHex: SPEC_HASH_HEX,
      fetch: service.fetchImpl,
    });
    expect(outcome.state).toBe("failed");
  });

  it("returns acquired on a clean, bound, recorded attestation", async () => {
    const service = fakeModerationService({});
    await expect(
      listingTrust.acquireListingAttestation({
        attestorEndpoint: "https://attest.example/api/task-moderation/attest",
        listing: LISTING,
        specUri: SPEC_URI,
        specHashHex: SPEC_HASH_HEX,
        fetch: service.fetchImpl,
      }),
    ).resolves.toEqual({ state: "acquired" });
  });

  it("maps a network-layer failure to failed (never throws)", async () => {
    const outcome = await listingTrust.acquireListingAttestation({
      attestorEndpoint: "https://attest.example/api/task-moderation/attest",
      listing: LISTING,
      specUri: SPEC_URI,
      specHashHex: SPEC_HASH_HEX,
      fetch: (async () => {
        throw new Error("connection refused");
      }) as typeof fetch,
    });
    expect(outcome.state).toBe("failed");
  });
});

// ----------------------------------------------------- end-to-end resolver

function resolverWith(opts: {
  accounts?: Map<string, Uint8Array>;
  roster?: Uint8Array[];
  failModerationReads?: boolean;
  storeModerators?: string[];
  trustPolicy?: listingTrust.ListingTrustPolicy;
  attestorEndpoint?: string | null;
  service?: ReturnType<typeof fakeModerationService>;
}) {
  const accounts =
    opts.accounts ?? new Map<string, Uint8Array>([[LISTING, encodeListing()]]);
  if (!accounts.has(LISTING)) accounts.set(LISTING, encodeListing());
  const rpc = fakeRpc({
    accounts,
    roster: opts.roster ?? [],
    failModerationReads: opts.failModerationReads ?? false,
  });
  const service = opts.service ?? fakeModerationService({});
  const resolve = listingTrust.createListingHireModerationResolver({
    rpcUrl: "http://fake.invalid",
    trustPolicy: opts.trustPolicy ?? "edge-list",
    resolveStoreModerators: async () => opts.storeModerators ?? [MOD_OWN],
    attestorEndpoint:
      opts.attestorEndpoint === undefined
        ? "https://attest.example/api/task-moderation/attest"
        : opts.attestorEndpoint,
    rpc,
    fetch: service.fetchImpl,
    maxResolveRetries: 2,
    retryDelayMs: 0,
    sleep: async () => {},
  });
  return { resolve, service, accounts, rpc };
}

describe("createListingHireModerationResolver (fail-closed end to end)", () => {
  it("consumes an existing valid record WITHOUT calling the attestation service", async () => {
    const accounts = new Map<string, Uint8Array>([
      [LISTING, encodeListing()],
      [await moderationPdaOf(MOD_OWN), encodeModeration({ moderator: MOD_OWN })],
    ]);
    const { resolve, service } = resolverWith({ accounts });
    await expect(resolve(LISTING)).resolves.toEqual({
      moderator: MOD_OWN,
      source: "existing-record",
    });
    expect(service.calls.count).toBe(0);
  });

  it("§12 rail: under any-bonded-attestor a FOREIGN roster attestor's record makes the listing hireable", async () => {
    const accounts = new Map<string, Uint8Array>([
      [LISTING, encodeListing()],
      [
        await moderationPdaOf(MOD_FOREIGN),
        encodeModeration({ moderator: MOD_FOREIGN }),
      ],
    ]);
    const { resolve, service } = resolverWith({
      accounts,
      roster: [encodeAttestor({ attestor: MOD_FOREIGN })],
      trustPolicy: "any-bonded-attestor",
    });
    await expect(resolve(LISTING)).resolves.toEqual({
      moderator: MOD_FOREIGN,
      source: "existing-record",
    });
    expect(service.calls.count).toBe(0);
  });

  it("edge-list does NOT consume the foreign record (today's behavior preserved) — it re-acquires instead", async () => {
    const accounts = new Map<string, Uint8Array>([
      [LISTING, encodeListing()],
      [
        await moderationPdaOf(MOD_FOREIGN),
        encodeModeration({ moderator: MOD_FOREIGN }),
      ],
    ]);
    const ownPda = await moderationPdaOf(MOD_OWN);
    const service = fakeModerationService({
      onRecord: () => {
        accounts.set(ownPda, encodeModeration({ moderator: MOD_OWN }));
      },
    });
    const { resolve } = resolverWith({ accounts, service, trustPolicy: "edge-list" });
    await expect(resolve(LISTING)).resolves.toEqual({
      moderator: MOD_OWN,
      source: "acquired",
    });
    expect(service.calls.count).toBe(1);
  });

  it("definitive miss → acquires from the store's own service, then re-discovers", async () => {
    const accounts = new Map<string, Uint8Array>([[LISTING, encodeListing()]]);
    const ownPda = await moderationPdaOf(MOD_OWN);
    const service = fakeModerationService({
      onRecord: () => {
        accounts.set(ownPda, encodeModeration({ moderator: MOD_OWN }));
      },
    });
    const { resolve } = resolverWith({ accounts, service });
    await expect(resolve(LISTING)).resolves.toEqual({
      moderator: MOD_OWN,
      source: "acquired",
    });
    expect(service.calls.count).toBe(1);
  });

  it("an EXPIRED existing record triggers acquisition — it must never short-circuit as consumable", async () => {
    const ownPda = await moderationPdaOf(MOD_OWN);
    const accounts = new Map<string, Uint8Array>([
      [LISTING, encodeListing()],
      [
        ownPda,
        encodeModeration({
          moderator: MOD_OWN,
          expiresAt: BigInt(Math.floor(Date.now() / 1000) - 3600),
        }),
      ],
    ]);
    const service = fakeModerationService({
      onRecord: () => {
        accounts.set(ownPda, encodeModeration({ moderator: MOD_OWN }));
      },
    });
    const { resolve } = resolverWith({ accounts, service });
    const resolved = await resolve(LISTING);
    // The stale record must be replaced through acquisition, not consumed.
    expect(service.calls.count).toBe(1);
    expect(resolved.source).toBe("acquired");
  });

  it("BLOCKED acquisition verdict fails closed with ListingModerationBlockedError", async () => {
    const service = fakeModerationService({ verdict: "blocked" });
    const { resolve } = resolverWith({ service });
    await expect(resolve(LISTING)).rejects.toMatchObject({
      name: "ListingModerationBlockedError",
    });
  });

  it("a transient RPC error during discovery PROPAGATES and never triggers a paid acquisition", async () => {
    const { resolve, service } = resolverWith({ failModerationReads: true });
    await expect(resolve(LISTING)).rejects.toThrow(/transiently unavailable/);
    expect(service.calls.count).toBe(0);
  });

  it("miss with acquisition disabled (localnet) fails closed with an honest error", async () => {
    const { resolve, service } = resolverWith({ attestorEndpoint: null });
    await expect(resolve(LISTING)).rejects.toThrow(/cannot be hired here/);
    expect(service.calls.count).toBe(0);
  });

  it("an EMPTY trusted-moderator set fails closed BEFORE any acquisition", async () => {
    const { resolve, service } = resolverWith({ storeModerators: [] });
    await expect(resolve(LISTING)).rejects.toThrow(/No trusted moderators/);
    expect(service.calls.count).toBe(0);
  });

  it("a listing that does not exist on-chain fails closed", async () => {
    const rpc = fakeRpc({ accounts: new Map() });
    const bare = listingTrust.createListingHireModerationResolver({
      rpcUrl: "http://fake.invalid",
      trustPolicy: "edge-list",
      resolveStoreModerators: async () => [MOD_OWN],
      attestorEndpoint: null,
      rpc,
    });
    await expect(bare(LISTING)).rejects.toThrow(/does not exist/);
  });

  it("acquisition that never lands a readable record times out with an actionable error", async () => {
    const service = fakeModerationService({}); // clean, but never writes the PDA
    const { resolve } = resolverWith({ service });
    await expect(resolve(LISTING)).rejects.toThrow(/did not become readable/);
    expect(service.calls.count).toBe(1);
  });
});
