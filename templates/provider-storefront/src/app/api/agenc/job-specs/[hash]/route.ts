/**
 * `GET /api/agenc/job-specs/[hash]` — serves the canonical job-spec JSON the
 * activation route hosted for a hire. The on-chain `TaskJobSpec.job_spec_uri`
 * points here; anyone (workers, verifiers, crawlers) can fetch the document
 * and check that its sha-256 matches the pinned `job_spec_hash`.
 */
import {
  readHostedJobSpec,
  resolveJobSpecDirectory,
} from "@tetsuo-ai/store-core/activation/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ hash: string }> };

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const { hash } = await params;
  // Same directory resolution as the activation route (honors the
  // AGENC_JOB_SPEC_DIR durable-volume override).
  const body = await readHostedJobSpec({
    directory: resolveJobSpecDirectory(),
    hashHex: hash,
  });
  if (body === null) {
    return Response.json({ error: "job spec not found" }, { status: 404 });
  }
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}
