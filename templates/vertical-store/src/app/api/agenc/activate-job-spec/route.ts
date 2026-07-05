/**
 * `POST /api/agenc/activate-job-spec` — the store's post-hire activation route
 * (WP-B1). Called by the hire flow after the hire transaction lands:
 * normalizes + canonicalizes the job spec, HOSTS the canonical JSON (served
 * back from `/api/agenc/job-specs/[hash]`), obtains the CLEAN task-moderation
 * attestation, and returns `{ jobSpecHashHex, jobSpecUri, moderationAttested,
 * moderator }` so the buyer's wallet can sign `set_task_job_spec` naming the
 * P1.2 `moderator` whose attestation record the gate consumes.
 *
 * `GET` serves the hire-moderator info leg. `GET ?listing=<pda>` (the §12
 * roster-trust rail) resolves the moderator whose consumable ListingModeration
 * record ACTUALLY EXISTS for that listing — own attestor, the global
 * moderation authority, or (under `moderation.trustPolicy:
 * "any-bonded-attestor"`) any bonded roster attestor — acquiring a fresh
 * attestation from the store's own service on a miss (BLOCKED fails closed).
 * A bare `GET` keeps serving the legacy listing-agnostic `{ moderator }`,
 * resolved from the optional `moderation.moderator` config override or the
 * attestation service's `GET /v1/info` (cached).
 *
 * ZERO moderation configuration is required (invisible-by-default): the
 * attestation is marketplace-managed automatically — on localnet the dev
 * sandbox's moderation key signs it locally. Operators running their OWN
 * attestor may set the optional sovereignty fields
 * `moderation.attestorEndpoint` / `moderation.moderator` in agenc.config.ts.
 */
import {
  createActivateJobSpecHandler,
  resolveActivationBackend,
} from "@tetsuo-ai/store-core/activation/server";
import { storeConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Built ONCE per server process (module scope) so the per-client rate limit
// and the hire-moderator cache actually accumulate across requests.
const backend = resolveActivationBackend(storeConfig);
const handler = createActivateJobSpecHandler({
  storeJobSpec: backend.storeJobSpec,
  attestTaskModeration: backend.attestTaskModeration,
  // The route is public by construction (the buyer's browser calls it):
  // verify the task really exists on-chain and is awaiting activation
  // before hosting or attesting anything.
  verifyTask: backend.verifyTask,
  // P1.2 moderator sourcing: the attestation response wins; the config
  // override is the fallback for outdated self-hosted attestors; the GET
  // leg serves the hire-gate moderator.
  moderatorOverride: backend.moderatorOverride,
  resolveHireModerator: backend.resolveHireModerator,
  // §12 roster-trust rail: the LISTING-scoped GET leg. Without this line a
  // cross-node hire names the store's own attestor blind and reverts
  // on-chain after the buyer signs.
  resolveListingHireModeration: backend.resolveListingHireModeration,
});

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}

export async function GET(request: Request): Promise<Response> {
  return handler(request);
}
