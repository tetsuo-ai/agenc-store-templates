/**
 * Unit tests for the §12 roster-trust consumption rail
 * (`activation/listing-trust`): trust-policy resolution, strict roster
 * scanning (discriminator filter, exit filtering, the MAX_ROSTER_ATTESTORS
 * bound, decode strictness), gate-mirroring record validity, the §5.2 BLOCK
 * floor, the global-authority candidate leg, the P1.3 liveness deadman,
 * discovery order and fall-through, acquisition trigger conditions
 * (single-flight + negative caching + catalog gating), the roster over-cap
 * degrade path, and the end-to-end resolver's fail-closed discipline.
 *
 * All on-chain state is faked at the RPC boundary with REAL sdk account
 * encoders (the same bytes a cluster would return), so the tests exercise
 * the real decode paths.
 *
 * NOTE: this file deliberately imports the module under test as a NAMESPACE
 * (`listingTrust.*`) and nothing from `activation/server.ts`, so the whole
 * suite still loads against earlier revisions of the module — that is what
 * makes the revert-sensitivity check meaningful (key tests here go RED
 * against the unaudited logic instead of dying on a missing import).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { getAddressDecoder, getBase58Decoder } from "@solana/kit";
import {
  AGENC_COORDINATION_PROGRAM_ADDRESS,
  facade,
  findListingModerationPda,
  findModerationAttestorPda,
  findModerationBlockPda,
  findModerationConfigPda,
  getListingModerationEncoder,
  getModerationAttestorEncoder,
  getModerationBlockEncoder,
  getModerationConfigEncoder,
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
const MOD_AUTHORITY = addrOf(14); // the global moderation authority
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
      reserved: new Uint8Array(7),
    }),
  );
}

function encodeListing(
  opts: { specUri?: string; state?: number; category?: string } = {},
): Uint8Array {
  const category = new Uint8Array(32);
  if (opts.category) {
    category.set(new TextEncoder().encode(opts.category));
  }
  return Uint8Array.from(
    getServiceListingEncoder().encode({
      providerAgent: addrOf(2) as never,
      authority: addrOf(3) as never,
      listingId: new Uint8Array(32),
      name: new Uint8Array(32),
      category,
      tags: new Uint8Array(64),
      specHash: SPEC_HASH,
      specUri: opts.specUri ?? SPEC_URI,
      price: 1_000n,
      priceMint: null,
      requiredCapabilities: 0n,
      defaultDeadlineSecs: 0n,
      operator: addrOf(0) as never,
      operatorFeeBps: 0,
      state: opts.state ?? 0,
      maxOpenJobs: 0,
      openJobs: 0,
      totalHires: 0n,
      totalRating: 0n,
      ratingCount: 0,
      version: 1n,
      createdAt: 1n,
      updatedAt: 1n,
      bump: 250,
      reserved: new Uint8Array(32),
    }),
  );
}

function encodeModerationConfig(input: {
  moderationAuthority?: string;
  enabled?: boolean;
  updatedAt?: bigint;
  windowSecs?: number;
}): Uint8Array {
  const reserved = new Uint8Array(6);
  const w = input.windowSecs ?? 0;
  reserved[0] = w & 0xff;
  reserved[1] = (w >>> 8) & 0xff;
  reserved[2] = (w >>> 16) & 0xff;
  reserved[3] = (w >>> 24) & 0xff;
  return Uint8Array.from(
    getModerationConfigEncoder().encode({
      authority: addrOf(1) as never,
      moderationAuthority: (input.moderationAuthority ?? MOD_AUTHORITY) as never,
      enabled: input.enabled ?? true,
      createdAt: 1n,
      updatedAt: input.updatedAt ?? BigInt(NOW),
      bump: 253,
      reserved,
    }),
  );
}

function encodeModerationBlock(status: number): Uint8Array {
  return Uint8Array.from(
    getModerationBlockEncoder().encode({
      contentHash: SPEC_HASH,
      status,
      rationaleHash: new Uint8Array(32).fill(3),
      rationaleUri: "https://gov.example.com/takedown.md",
      setAt: 1n,
      updatedAt: 1n,
      updatedBy: addrOf(1) as never,
      bump: 252,
      reserved: new Uint8Array(16),
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

async function attestorPdaOf(moderator: string): Promise<string> {
  const [pda] = await findModerationAttestorPda({
    attestor: moderator as never,
  });
  return String(pda);
}

async function blockPda(): Promise<string> {
  const [pda] = await findModerationBlockPda({ contentHash: SPEC_HASH });
  return String(pda);
}

async function configPda(): Promise<string> {
  const [pda] = await findModerationConfigPda();
  return String(pda);
}

/** A STRICT (enabled, fresh-heartbeat, authority-set) config snapshot. */
function strictConfig(
  overrides: Partial<listingTrust.ModerationConfigSnapshot> = {},
): listingTrust.ModerationConfigSnapshot {
  return {
    exists: true,
    moderationAuthority: MOD_AUTHORITY,
    enabled: true,
    updatedAt: BigInt(Math.floor(Date.now() / 1000)),
    livenessWindowSecs: 0,
    ...overrides,
  };
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

  it("raises the TYPED RosterCapExceededError over the bound — never silently truncates", async () => {
    const over = Array.from(
      { length: listingTrust.MAX_ROSTER_ATTESTORS + 1 },
      (_, i) => encodeAttestor({ attestor: addrOf(1 + (i % 250)) }),
    );
    const rpc = fakeRpc({ roster: over });
    await expect(listingTrust.fetchRosterAttestors(rpc)).rejects.toThrow(
      /MAX_ROSTER_ATTESTORS/,
    );
    await expect(listingTrust.fetchRosterAttestors(rpc)).rejects.toMatchObject({
      name: "RosterCapExceededError",
    });
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
    const rpcB = fakeRpc({
      roster: [encodeAttestor({ attestor: MOD_EXITING, exitAt: 5n })],
    });
    expect((await listingTrust.bondedRosterModerators(rpcA)).active).toEqual([
      MOD_FOREIGN,
    ]);
    const b = await listingTrust.bondedRosterModerators(rpcB);
    expect(b.active).toEqual([]);
    expect(b.exiting.has(MOD_EXITING)).toBe(true);
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

// ---------------------------------------------- config + liveness deadman

describe("moderationLivenessRelaxed (mirror of the P1.3 deadman predicate)", () => {
  const heartbeat = 1_700_000_000n;
  const DEFAULT = listingTrust.DEFAULT_MODERATION_LIVENESS_WINDOW_SECS;

  it("stays STRICT inside the default window (incl. the exact boundary), relaxes one past it", () => {
    expect(
      listingTrust.moderationLivenessRelaxed(heartbeat, 0, Number(heartbeat)),
    ).toBe(false);
    expect(
      listingTrust.moderationLivenessRelaxed(
        heartbeat,
        0,
        Number(heartbeat) + DEFAULT,
      ),
    ).toBe(false);
    expect(
      listingTrust.moderationLivenessRelaxed(
        heartbeat,
        0,
        Number(heartbeat) + DEFAULT + 1,
      ),
    ).toBe(true);
  });

  it("honors a carved custom window and stays strict for a never-written heartbeat", () => {
    expect(
      listingTrust.moderationLivenessRelaxed(
        heartbeat,
        86_400,
        Number(heartbeat) + 86_400,
      ),
    ).toBe(false);
    expect(
      listingTrust.moderationLivenessRelaxed(
        heartbeat,
        86_400,
        Number(heartbeat) + 86_401,
      ),
    ).toBe(true);
    // updated_at == 0: an account that was never written — STRICT forever.
    expect(listingTrust.moderationLivenessRelaxed(0n, 0, NOW)).toBe(false);
  });
});

describe("moderationConfigSnapshot", () => {
  it("decodes authority, enabled, heartbeat and the reserved-carved window; caches per rpc", async () => {
    const accounts = new Map<string, Uint8Array>([
      [
        await configPda(),
        encodeModerationConfig({
          moderationAuthority: MOD_AUTHORITY,
          enabled: true,
          updatedAt: 1_234n,
          windowSecs: 604_800,
        }),
      ],
    ]);
    const rpc = fakeRpc({ accounts });
    const snapshot = await listingTrust.moderationConfigSnapshot(rpc);
    expect(snapshot).toEqual({
      exists: true,
      moderationAuthority: MOD_AUTHORITY,
      enabled: true,
      updatedAt: 1_234n,
      livenessWindowSecs: 604_800,
    });
    // Cached: mutating the backing map does not change the snapshot.
    accounts.delete(await configPda());
    expect((await listingTrust.moderationConfigSnapshot(rpc)).exists).toBe(true);
  });

  it("a MISSING config is a definitive exists:false snapshot; the default authority reads as null", async () => {
    expect(
      await listingTrust.moderationConfigSnapshot(fakeRpc({ accounts: new Map() })),
    ).toMatchObject({ exists: false, moderationAuthority: null });
    const unset = new Map<string, Uint8Array>([
      [
        await configPda(),
        encodeModerationConfig({
          moderationAuthority: "11111111111111111111111111111111",
        }),
      ],
    ]);
    expect(
      (await listingTrust.moderationConfigSnapshot(fakeRpc({ accounts: unset })))
        .moderationAuthority,
    ).toBeNull();
  });
});

// ------------------------------------------------------------- BLOCK floor

describe("isSpecHashBlocked (§5.2 BLOCK floor mirror)", () => {
  it("true for a BLOCKED takedown, false for CLEARED (audit trail) and missing", async () => {
    const blocked = new Map<string, Uint8Array>([
      [
        await blockPda(),
        encodeModerationBlock(listingTrust.MODERATION_BLOCK_STATUS.BLOCKED),
      ],
    ]);
    expect(
      await listingTrust.isSpecHashBlocked(
        fakeRpc({ accounts: blocked }),
        SPEC_HASH_HEX,
      ),
    ).toBe(true);

    const cleared = new Map<string, Uint8Array>([
      [
        await blockPda(),
        encodeModerationBlock(listingTrust.MODERATION_BLOCK_STATUS.CLEARED),
      ],
    ]);
    expect(
      await listingTrust.isSpecHashBlocked(
        fakeRpc({ accounts: cleared }),
        SPEC_HASH_HEX,
      ),
    ).toBe(false);

    expect(
      await listingTrust.isSpecHashBlocked(
        fakeRpc({ accounts: new Map() }),
        SPEC_HASH_HEX,
      ),
    ).toBe(false);
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

async function baseAccounts(
  extra: Array<[string, Uint8Array]> = [],
): Promise<Map<string, Uint8Array>> {
  return new Map<string, Uint8Array>([
    [LISTING, encodeListing()],
    // The store's own attestor is roster-registered (the live topology).
    [await attestorPdaOf(MOD_OWN), encodeAttestor({ attestor: MOD_OWN })],
    ...extra,
  ]);
}

function resolverWith(opts: {
  accounts: Map<string, Uint8Array>;
  roster?: Uint8Array[] | (() => Uint8Array[]);
  failModerationReads?: boolean;
  storeModerators?: string[];
  trustPolicy?: listingTrust.ListingTrustPolicy;
  attestorEndpoint?: string | null;
  service?: ReturnType<typeof fakeModerationService>;
  moderationConfig?: listingTrust.ModerationConfigSnapshot;
  curation?: listingTrust.ListingHireModerationDeps["curation"];
  negativeTtlMs?: number;
  warnings?: string[];
}) {
  const rpc = fakeRpc({
    accounts: opts.accounts,
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
    curation: opts.curation,
    rpc,
    moderationConfig: opts.moderationConfig ?? strictConfig(),
    fetch: service.fetchImpl,
    maxResolveRetries: 2,
    retryDelayMs: 0,
    sleep: async () => {},
    ...(opts.negativeTtlMs !== undefined
      ? { negativeTtlMs: opts.negativeTtlMs }
      : {}),
    warn: (m: string) => opts.warnings?.push(m),
  });
  return { resolve, service, rpc };
}

describe("createListingHireModerationResolver (fail-closed end to end)", () => {
  it("consumes an existing valid record WITHOUT calling the attestation service", async () => {
    const accounts = await baseAccounts([
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
    const accounts = await baseAccounts([
      [
        await moderationPdaOf(MOD_FOREIGN),
        encodeModeration({ moderator: MOD_FOREIGN }),
      ],
      [
        await attestorPdaOf(MOD_FOREIGN),
        encodeAttestor({ attestor: MOD_FOREIGN }),
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
    const accounts = await baseAccounts([
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
    const accounts = await baseAccounts();
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
    const accounts = await baseAccounts([
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
    const { resolve } = resolverWith({ accounts: await baseAccounts(), service });
    await expect(resolve(LISTING)).rejects.toMatchObject({
      name: "ListingModerationBlockedError",
    });
  });

  it("a transient RPC error during discovery PROPAGATES and never triggers a paid acquisition", async () => {
    const { resolve, service } = resolverWith({
      accounts: await baseAccounts(),
      failModerationReads: true,
    });
    await expect(resolve(LISTING)).rejects.toThrow(/transiently unavailable/);
    expect(service.calls.count).toBe(0);
  });

  it("miss with acquisition disabled (localnet) fails closed with an honest error", async () => {
    const { resolve, service } = resolverWith({
      accounts: await baseAccounts(),
      attestorEndpoint: null,
    });
    await expect(resolve(LISTING)).rejects.toThrow(/cannot be hired here/);
    expect(service.calls.count).toBe(0);
  });

  it("an EMPTY trusted-moderator set fails closed BEFORE any acquisition", async () => {
    const { resolve, service } = resolverWith({
      accounts: await baseAccounts(),
      storeModerators: [],
      moderationConfig: strictConfig({ moderationAuthority: null }),
    });
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
      moderationConfig: strictConfig(),
    });
    await expect(bare(LISTING)).rejects.toThrow(/does not exist/);
  });

  it("acquisition that never lands a readable record times out with an actionable error", async () => {
    const service = fakeModerationService({}); // clean, but never writes the PDA
    const { resolve } = resolverWith({ accounts: await baseAccounts(), service });
    await expect(resolve(LISTING)).rejects.toThrow(/did not become readable/);
    expect(service.calls.count).toBe(1);
  });
});

describe("F2: the §5.2 BLOCK floor in the resolver", () => {
  it("a multisig-BLOCKED hash fails closed as blocked EVEN when a CLEAN trusted record exists", async () => {
    const accounts = await baseAccounts([
      [
        await blockPda(),
        encodeModerationBlock(listingTrust.MODERATION_BLOCK_STATUS.BLOCKED),
      ],
      [await moderationPdaOf(MOD_OWN), encodeModeration({ moderator: MOD_OWN })],
    ]);
    const { resolve, service } = resolverWith({ accounts });
    await expect(resolve(LISTING)).rejects.toMatchObject({
      name: "ListingModerationBlockedError",
    });
    expect(service.calls.count).toBe(0);
  });

  it("a miss on a BLOCKED hash NEVER pays for an acquisition (repeatably — negative-cached)", async () => {
    const accounts = await baseAccounts([
      [
        await blockPda(),
        encodeModerationBlock(listingTrust.MODERATION_BLOCK_STATUS.BLOCKED),
      ],
    ]);
    const { resolve, service } = resolverWith({ accounts });
    await expect(resolve(LISTING)).rejects.toMatchObject({
      name: "ListingModerationBlockedError",
    });
    await expect(resolve(LISTING)).rejects.toMatchObject({
      name: "ListingModerationBlockedError",
    });
    expect(service.calls.count).toBe(0);
  });

  it("a CLEARED takedown (audit trail) does not block", async () => {
    const accounts = await baseAccounts([
      [
        await blockPda(),
        encodeModerationBlock(listingTrust.MODERATION_BLOCK_STATUS.CLEARED),
      ],
      [await moderationPdaOf(MOD_OWN), encodeModeration({ moderator: MOD_OWN })],
    ]);
    const { resolve } = resolverWith({ accounts });
    await expect(resolve(LISTING)).resolves.toMatchObject({
      moderator: MOD_OWN,
    });
  });
});

describe("F3: the global moderation authority is a first-class candidate", () => {
  it("an authority-authored v2 record resolves WITHOUT acquisition (no roster entry needed)", async () => {
    const accounts = await baseAccounts([
      [
        await moderationPdaOf(MOD_AUTHORITY),
        encodeModeration({ moderator: MOD_AUTHORITY }),
      ],
    ]);
    const { resolve, service } = resolverWith({ accounts });
    await expect(resolve(LISTING)).resolves.toEqual({
      moderator: MOD_AUTHORITY,
      source: "existing-record",
    });
    expect(service.calls.count).toBe(0);
  });

  it("an authority-authored LEGACY record (all pre-P1.2 records) resolves too", async () => {
    const accounts = await baseAccounts([
      [await legacyPda(), encodeModeration({ moderator: MOD_AUTHORITY })],
    ]);
    const { resolve, service } = resolverWith({ accounts });
    await expect(resolve(LISTING)).resolves.toEqual({
      moderator: MOD_AUTHORITY,
      source: "existing-record",
    });
    expect(service.calls.count).toBe(0);
  });

  it("without the authority in the config, the same record is a miss (the pre-F3 failure)", async () => {
    const accounts = await baseAccounts([
      [
        await moderationPdaOf(MOD_AUTHORITY),
        encodeModeration({ moderator: MOD_AUTHORITY }),
      ],
    ]);
    const { resolve, service } = resolverWith({
      accounts,
      moderationConfig: strictConfig({ moderationAuthority: null }),
      attestorEndpoint: null,
    });
    await expect(resolve(LISTING)).rejects.toThrow(/cannot be hired here/);
    expect(service.calls.count).toBe(0);
  });
});

describe("F4: roster over-cap degrades instead of killing the network", () => {
  const overCapRoster = () =>
    Array.from({ length: listingTrust.MAX_ROSTER_ATTESTORS + 1 }, (_, i) =>
      encodeAttestor({ attestor: addrOf(1 + (i % 250)) }),
    );

  it("an own-record hire still resolves with the roster over cap — and never even scans it", async () => {
    const accounts = await baseAccounts([
      [await moderationPdaOf(MOD_OWN), encodeModeration({ moderator: MOD_OWN })],
    ]);
    const { resolve, rpc } = resolverWith({
      accounts,
      roster: overCapRoster,
      trustPolicy: "any-bonded-attestor",
    });
    await expect(resolve(LISTING)).resolves.toMatchObject({
      moderator: MOD_OWN,
    });
    // Own-set discovery runs FIRST: the over-cap roster was never consulted.
    expect(rpc.state.gpaCalls).toBe(0);
  });

  it("own miss + over-cap: degrades with a loud warning, DISABLES acquisition, fails honestly", async () => {
    const warnings: string[] = [];
    const { resolve, service } = resolverWith({
      accounts: await baseAccounts(),
      roster: overCapRoster,
      trustPolicy: "any-bonded-attestor",
      warnings,
    });
    await expect(resolve(LISTING)).rejects.toThrow(/degraded/);
    // The paid side effect must NOT fire off a silently-shrunken trust set.
    expect(service.calls.count).toBe(0);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/MAX_ROSTER_ATTESTORS/);
  });

  it("a TRANSIENT roster error still propagates (only the typed cap error degrades)", async () => {
    const { resolve, service } = resolverWith({
      accounts: await baseAccounts(),
      roster: () => {
        throw new Error("roster rpc transiently unavailable");
      },
      trustPolicy: "any-bonded-attestor",
    });
    await expect(resolve(LISTING)).rejects.toThrow(/transiently unavailable/);
    expect(service.calls.count).toBe(0);
  });
});

describe("F5: acquisition cost-amplification hardening", () => {
  it("single-flight: concurrent misses for one listing fire exactly ONE paid acquisition", async () => {
    const accounts = await baseAccounts();
    const ownPda = await moderationPdaOf(MOD_OWN);
    const service = fakeModerationService({
      onRecord: () => {
        accounts.set(ownPda, encodeModeration({ moderator: MOD_OWN }));
      },
    });
    const { resolve } = resolverWith({ accounts, service });
    const [a, b, c] = await Promise.all([
      resolve(LISTING),
      resolve(LISTING),
      resolve(LISTING),
    ]);
    expect(a.moderator).toBe(MOD_OWN);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(service.calls.count).toBe(1);
  });

  it("negative cache: a failed acquisition is not retried (or re-paid) within the TTL", async () => {
    const service = fakeModerationService({ attestation: false }); // clean but recordless
    const { resolve } = resolverWith({
      accounts: await baseAccounts(),
      service,
      negativeTtlMs: 60_000,
    });
    await expect(resolve(LISTING)).rejects.toThrow(/could not be acquired/);
    await expect(resolve(LISTING)).rejects.toThrow(/could not be acquired/);
    expect(service.calls.count).toBe(1);
  });

  it("catalog gate: a listing outside the store's curation NEVER resolves or acquires", async () => {
    const { resolve, service } = resolverWith({
      accounts: await baseAccounts(),
      curation: { providers: [addrOf(99) as never], requireModeration: true },
    });
    await expect(resolve(LISTING)).rejects.toThrow(/not part of this store/);
    expect(service.calls.count).toBe(0);
  });

  it("catalog gate: category curation admits matching listings and rejects others", async () => {
    const inCatalog = await baseAccounts([
      [await moderationPdaOf(MOD_OWN), encodeModeration({ moderator: MOD_OWN })],
    ]);
    inCatalog.set(LISTING, encodeListing({ category: "code-generation" }));
    const admitted = resolverWith({
      accounts: inCatalog,
      curation: { categories: ["code-generation"], requireModeration: true },
    });
    await expect(admitted.resolve(LISTING)).resolves.toMatchObject({
      moderator: MOD_OWN,
    });

    const outOfCatalog = await baseAccounts();
    outOfCatalog.set(LISTING, encodeListing({ category: "art" }));
    const rejected = resolverWith({
      accounts: outOfCatalog,
      curation: { categories: ["code-generation"], requireModeration: true },
    });
    await expect(rejected.resolve(LISTING)).rejects.toThrow(
      /not part of this store/,
    );
    expect(rejected.service.calls.count).toBe(0);
  });

  it("a paused/retired listing never resolves or acquires", async () => {
    const accounts = await baseAccounts();
    accounts.set(LISTING, encodeListing({ state: 1 }));
    const { resolve, service } = resolverWith({ accounts });
    await expect(resolve(LISTING)).rejects.toThrow(/not active/);
    expect(service.calls.count).toBe(0);
  });
});

describe("F6: the P1.3 liveness deadman / disabled gate", () => {
  it("moderation DISABLED on-chain → listing-agnostic moderator, NO acquisition", async () => {
    const { resolve, service } = resolverWith({
      accounts: await baseAccounts(),
      moderationConfig: strictConfig({ enabled: false }),
    });
    await expect(resolve(LISTING)).resolves.toEqual({
      moderator: MOD_OWN,
      source: "relaxed-gate",
    });
    expect(service.calls.count).toBe(0);
  });

  it("deadman RELAXED (silent authority past the window) → relaxed-gate, no acquisition", async () => {
    const staleHeartbeat = BigInt(
      Math.floor(Date.now() / 1000) -
        listingTrust.DEFAULT_MODERATION_LIVENESS_WINDOW_SECS -
        60,
    );
    const { resolve, service } = resolverWith({
      accounts: await baseAccounts(),
      moderationConfig: strictConfig({ updatedAt: staleHeartbeat }),
    });
    await expect(resolve(LISTING)).resolves.toEqual({
      moderator: MOD_OWN,
      source: "relaxed-gate",
    });
    expect(service.calls.count).toBe(0);
  });

  it("a FRESH heartbeat stays strict: the same miss goes to acquisition, not relaxed-gate", async () => {
    const accounts = await baseAccounts();
    const ownPda = await moderationPdaOf(MOD_OWN);
    const service = fakeModerationService({
      onRecord: () => {
        accounts.set(ownPda, encodeModeration({ moderator: MOD_OWN }));
      },
    });
    const { resolve } = resolverWith({
      accounts,
      service,
      moderationConfig: strictConfig(), // fresh updatedAt
    });
    await expect(resolve(LISTING)).resolves.toMatchObject({
      source: "acquired",
    });
    expect(service.calls.count).toBe(1);
  });

  it("the BLOCK floor is NEVER relaxed: blocked hash + relaxed gate still fails closed", async () => {
    const accounts = await baseAccounts([
      [
        await blockPda(),
        encodeModerationBlock(listingTrust.MODERATION_BLOCK_STATUS.BLOCKED),
      ],
    ]);
    const { resolve, service } = resolverWith({
      accounts,
      moderationConfig: strictConfig({ enabled: false }),
    });
    await expect(resolve(LISTING)).rejects.toMatchObject({
      name: "ListingModerationBlockedError",
    });
    expect(service.calls.count).toBe(0);
  });
});

describe("unlockability: a record's author must be able to unlock the gate", () => {
  it("skips a record authored by an EXITING attestor and consumes the authority's instead", async () => {
    const accounts = await baseAccounts([
      [await moderationPdaOf(MOD_OWN), encodeModeration({ moderator: MOD_OWN })],
      [
        await moderationPdaOf(MOD_AUTHORITY),
        encodeModeration({ moderator: MOD_AUTHORITY }),
      ],
    ]);
    // MOD_OWN's roster entry is EXITING → its record cannot unlock.
    accounts.set(
      await attestorPdaOf(MOD_OWN),
      encodeAttestor({ attestor: MOD_OWN, exitAt: 1_700_000_000n }),
    );
    const { resolve } = resolverWith({ accounts });
    await expect(resolve(LISTING)).resolves.toEqual({
      moderator: MOD_AUTHORITY,
      source: "existing-record",
    });
  });

  it("a record whose author has NO roster entry and is not the authority is never named", async () => {
    const accounts = await baseAccounts([
      [
        await moderationPdaOf(MOD_FOREIGN),
        encodeModeration({ moderator: MOD_FOREIGN }),
      ],
      // No attestor account for MOD_FOREIGN → revoked/never-registered.
    ]);
    const { resolve, service } = resolverWith({
      accounts,
      // Trust MOD_FOREIGN explicitly (a store override) — the gate still
      // rejects it without a roster entry, so the resolver must too.
      storeModerators: [MOD_FOREIGN],
      moderationConfig: strictConfig({ moderationAuthority: null }),
      attestorEndpoint: null,
    });
    await expect(resolve(LISTING)).rejects.toThrow(/cannot be hired here/);
    expect(service.calls.count).toBe(0);
  });
});
