/**
 * Route + wiring tests for the §12 roster-trust rail:
 *
 * - the activation route's `GET ?listing=<pda>` leg (200 / 422 blocked /
 *   502 fail-closed / 400 malformed / 429 rate-limited / legacy fallback);
 * - `resolveActivationBackend` actually WIRING the listing resolver and the
 *   effective trust policy (the abandoned WIP documented this and never did
 *   it);
 * - the `moderation.trustPolicy` config schema surface.
 */
import { describe, expect, it } from "vitest";
import {
  createActivateJobSpecHandler,
  createMemoryJobSpecStore,
  ListingModerationBlockedError,
  resolveActivationBackend,
  type ListingHireModeration,
} from "../src/activation/server.js";
import { defineStore, safeDefineStore } from "../src/config/index.js";

const LISTING_PDA = "8iC21EoERDWSXRc5AH8fQBaV32pMSsAN3P7jumi15pH6";
const MODERATOR = "13tuj7ELwtHmeR22kvaSaa2pKqSscyoHtQBF65aHuo6v";

function handlerWith(deps?: {
  resolveListingHireModeration?: (l: string) => Promise<ListingHireModeration>;
  resolveHireModerator?: () => Promise<string>;
  rateLimit?: { limit: number; windowMs: number } | false;
}) {
  const hosting = createMemoryJobSpecStore({
    publicBaseUrl: "http://localhost:3000/api/agenc/job-specs",
  });
  return createActivateJobSpecHandler({
    storeJobSpec: hosting.storeJobSpec,
    attestTaskModeration: async () => ({ attested: true, moderator: MODERATOR }),
    resolveListingHireModeration: deps?.resolveListingHireModeration,
    resolveHireModerator: deps?.resolveHireModerator,
    rateLimit: deps?.rateLimit ?? false,
  });
}

function getRequest(query = "", ip = "203.0.113.9"): Request {
  return new Request(
    `http://store.local/api/agenc/activate-job-spec${query}`,
    { headers: { "x-forwarded-for": ip } },
  );
}

describe("activation route GET ?listing=<pda> (roster-trust leg)", () => {
  it("serves the listing-scoped moderator + source", async () => {
    const seen: string[] = [];
    const handler = handlerWith({
      resolveListingHireModeration: async (listing) => {
        seen.push(listing);
        return { moderator: MODERATOR, source: "existing-record" };
      },
    });
    const response = await handler(getRequest(`?listing=${LISTING_PDA}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      moderator: MODERATOR,
      source: "existing-record",
    });
    expect(seen).toEqual([LISTING_PDA]);
  });

  it("maps a BLOCKED listing to 422 { blocked: true } (fail-closed, honest)", async () => {
    const handler = handlerWith({
      resolveListingHireModeration: async () => {
        throw new ListingModerationBlockedError(
          "The attestation service BLOCKED this listing's spec.",
        );
      },
    });
    const response = await handler(getRequest(`?listing=${LISTING_PDA}`));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ blocked: true });
  });

  it("maps any other resolver failure to 502 with the reason — never a guessed moderator", async () => {
    const handler = handlerWith({
      resolveListingHireModeration: async () => {
        throw new Error("rpc transiently unavailable");
      },
      // Even with a legacy resolver available, the listing-scoped leg must
      // NOT fall back to the listing-agnostic guess on failure.
      resolveHireModerator: async () => MODERATOR,
    });
    const response = await handler(getRequest(`?listing=${LISTING_PDA}`));
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string; moderator?: string };
    expect(body.error).toMatch(/transiently unavailable/);
    expect(body.moderator).toBeUndefined();
  });

  it("400s a malformed listing param instead of silently answering listing-agnostically", async () => {
    const handler = handlerWith({
      resolveListingHireModeration: async () => ({
        moderator: MODERATOR,
        source: "existing-record",
      }),
      resolveHireModerator: async () => MODERATOR,
    });
    const response = await handler(getRequest("?listing=not-a-pda!!"));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(
      /base58/,
    );
  });

  it("falls back to the legacy listing-agnostic GET when no listing resolver is wired", async () => {
    const handler = handlerWith({
      resolveHireModerator: async () => MODERATOR,
    });
    const response = await handler(getRequest(`?listing=${LISTING_PDA}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ moderator: MODERATOR });
  });

  it("rate-limits the listing leg (discovery/acquisition is not a free primitive)", async () => {
    const handler = handlerWith({
      resolveListingHireModeration: async () => ({
        moderator: MODERATOR,
        source: "acquired",
      }),
      rateLimit: { limit: 1, windowMs: 60_000 },
    });
    const ip = `203.0.113.${Math.floor(Math.random() * 200)}`;
    expect((await handler(getRequest(`?listing=${LISTING_PDA}`, ip))).status).toBe(
      200,
    );
    expect((await handler(getRequest(`?listing=${LISTING_PDA}`, ip))).status).toBe(
      429,
    );
  });
});

describe("resolveActivationBackend wires the roster-trust rail", () => {
  function config(moderation?: Record<string, unknown>) {
    return defineStore({
      name: "Trust Store",
      description: "d",
      network: "devnet",
      api: { baseUrl: "https://indexer.example.com" },
      referrer: { wallet: LISTING_PDA, feeBps: 250 },
      seo: { siteUrl: "https://store.example.com" },
      ...(moderation ? { moderation } : {}),
    });
  }

  it("always provides a listing resolver; trust policy defaults to edge-list", () => {
    const backend = resolveActivationBackend(config(), {});
    expect(typeof backend.resolveListingHireModeration).toBe("function");
    expect(backend.trustPolicy).toBe("edge-list");
  });

  it("reflects moderation.trustPolicy from config", () => {
    const backend = resolveActivationBackend(
      config({ trustPolicy: "any-bonded-attestor" }),
      {},
    );
    expect(backend.trustPolicy).toBe("any-bonded-attestor");
  });

  it("honors the AGENC_MODERATION_TRUST deploy env as a fallback, config wins", () => {
    expect(
      resolveActivationBackend(config(), {
        AGENC_MODERATION_TRUST: "any-bonded-attestor",
      }).trustPolicy,
    ).toBe("any-bonded-attestor");
    expect(
      resolveActivationBackend(config({ trustPolicy: "edge-list" }), {
        AGENC_MODERATION_TRUST: "any-bonded-attestor",
      }).trustPolicy,
    ).toBe("edge-list");
  });
});

describe("moderation.trustPolicy config schema", () => {
  const base = {
    name: "Trust Store",
    description: "d",
    network: "devnet" as const,
    api: { baseUrl: "https://indexer.example.com" },
    referrer: { wallet: LISTING_PDA, feeBps: 250 },
    seo: { siteUrl: "https://store.example.com" },
  };

  it("accepts both policies and stays optional", () => {
    expect(
      safeDefineStore({
        ...base,
        moderation: { trustPolicy: "any-bonded-attestor" },
      }).success,
    ).toBe(true);
    expect(
      safeDefineStore({ ...base, moderation: { trustPolicy: "edge-list" } })
        .success,
    ).toBe(true);
    expect(safeDefineStore(base).success).toBe(true);
  });

  it("rejects unknown policies (strict enum)", () => {
    expect(
      safeDefineStore({
        ...base,
        moderation: { trustPolicy: "trust-everyone" },
      }).success,
    ).toBe(false);
  });
});
