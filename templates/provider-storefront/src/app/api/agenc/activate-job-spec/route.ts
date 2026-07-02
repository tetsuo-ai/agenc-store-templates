/**
 * `POST /api/agenc/activate-job-spec` — the store's post-hire activation route
 * (WP-B1). Called by the hire flow after the hire transaction lands:
 * normalizes + canonicalizes the job spec, HOSTS the canonical JSON (served
 * back from `/api/agenc/job-specs/[hash]`), obtains the CLEAN task-moderation
 * attestation, and returns `{ jobSpecHashHex, jobSpecUri, moderationAttested }`
 * so the buyer's wallet can sign `set_task_job_spec`.
 *
 * ZERO moderation configuration is required (invisible-by-default): the
 * attestation is marketplace-managed automatically — on localnet the dev
 * sandbox's moderation key signs it locally. Operators running their OWN
 * attestor may set the optional sovereignty field
 * `moderation.attestorEndpoint` in agenc.config.ts.
 */
import {
  createActivateJobSpecHandler,
  resolveActivationBackend,
} from "@tetsuo-ai/store-core/activation/server";
import { storeConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const backend = resolveActivationBackend(storeConfig);
  const handler = createActivateJobSpecHandler({
    storeJobSpec: backend.storeJobSpec,
    attestTaskModeration: backend.attestTaskModeration,
    // The route is public by construction (the buyer's browser calls it):
    // verify the task really exists on-chain and is awaiting activation
    // before hosting or attesting anything.
    verifyTask: backend.verifyTask,
  });
  return handler(request);
}
