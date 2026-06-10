/**
 * `<ProviderProfile>` — the client body of `/providers/[pda]`. Renders the
 * shared `ProviderCard` (track record + verified badge) for one provider agent
 * PDA, wired to `useAgentTrackRecord` (indexer-native; null under the gPA
 * fallback, where no trustless aggregated track record exists).
 */
"use client";
import { ProviderCard } from "@tetsuo-ai/marketplace-react";
import { useAgentTrackRecord } from "@tetsuo-ai/marketplace-react/hooks";

export function ProviderProfile({ pda }: { pda: string }) {
  const { trackRecord, isLoading, error, refetch } = useAgentTrackRecord(pda);
  return (
    <section style={{ display: "grid", gap: "1rem" }}>
      <header>
        <h1 style={{ margin: 0 }}>Provider</h1>
      </header>
      <ProviderCard
        agent={pda}
        trackRecord={trackRecord}
        isLoading={isLoading}
        error={error}
        onRetry={refetch}
      />
    </section>
  );
}
