/**
 * `/.well-known/agenc-store.json` (P5.2) — this store's portable identity
 * manifest (schema `agenc.storeManifest.v1`). A signed, DOMAIN-NEUTRAL proof
 * that the owner wallet authored exactly this store config (fees, moderation
 * posture, agents), verifiable by ANY surface — agenc.ag, another node, or a
 * 20-line third-party verifier. Thin wrapper over the shared
 * `store-core/manifest` helper (the C1 rule: templates are layout + config
 * only).
 *
 * Until the owner signs (the one-signature flow documented in
 * `agenc.config.ts` → `manifest`), this serves the unsigned envelope
 * (`signature: null`, `status: "unsigned"`) with the exact `signing.message`
 * to sign — surfaces treat unsigned as UNVERIFIED, never as invalid.
 */
import { storeManifestEnvelopeFromConfig } from "@tetsuo-ai/store-core/manifest";
import { storeConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const envelope = await storeManifestEnvelopeFromConfig(storeConfig);
  return Response.json(envelope, {
    headers: { "access-control-allow-origin": "*" },
  });
}
