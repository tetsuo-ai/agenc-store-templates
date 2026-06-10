/**
 * `/providers/[pda]` — the provider profile page (PLAN_2 C3). Thin SSR shell
 * around the client `<ProviderProfile>` (the track record is an indexer-native
 * read, so it loads client-side).
 */
import { ProviderProfile } from "./profile";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pda: string }> };

export default async function ProviderPage({ params }: Params) {
  const { pda } = await params;
  return <ProviderProfile pda={pda} />;
}
