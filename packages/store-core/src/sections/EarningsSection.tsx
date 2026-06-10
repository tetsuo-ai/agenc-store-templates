/**
 * `<EarningsSection>` — the store OWNER's `/earnings` page (PLAN_2 C3). Readonly,
 * keyed to the configured `referrer.wallet`, backed by `useReferrerEarnings`.
 *
 * ## THE P6.2 GATE (PLAN_2 §0, MANDATORY)
 *
 * The on-chain referrer settlement leg is NOT deployed. `useReferrerEarnings`
 * returns the documented not-live zero state today and this section RENDERS that
 * state honestly ("referral earnings are not live yet — pending protocol
 * support"). It NEVER fabricates a total and NEVER implies fees have been
 * collected. When P6.2 ships, only the hook's capability flag flips — this
 * component's per-hire table renders the real data with no surface change.
 *
 * Client component (`"use client"`): it uses hooks.
 *
 * @module sections/EarningsSection
 */
"use client";
import type { ReactElement } from "react";
import { StateMessage, truncateAddress } from "@tetsuo-ai/marketplace-react";
import { useReferrerEarnings } from "@tetsuo-ai/marketplace-react/hooks";
import { lamportsToSol } from "../seo/url.js";

/** Props for {@link EarningsSection}. */
export interface EarningsSectionProps {
  /** The store owner's referrer wallet (from `config.referrer.wallet`). */
  referrerWallet: string;
  /** The configured referral fee in bps (shown alongside the not-live notice). */
  feeBps: number;
  /** Emit no theme classes (white-label). */
  unstyled?: boolean;
}

/**
 * The owner earnings view. Honest about the P6.2 gate.
 *
 * @param props - {@link EarningsSectionProps}.
 */
export function EarningsSection({
  referrerWallet,
  feeBps,
  unstyled,
}: EarningsSectionProps): ReactElement {
  const { live, totalLamports, hires, isLoading, error, reason, refetch } =
    useReferrerEarnings(referrerWallet);

  if (isLoading) {
    return <StateMessage kind="loading" unstyled={unstyled} />;
  }
  if (error) {
    return <StateMessage kind="error" onRetry={refetch} unstyled={unstyled} />;
  }

  const sectionStyle = unstyled
    ? undefined
    : {
        display: "grid",
        gap: "1rem",
      };

  return (
    <section className={unstyled ? undefined : "agenc"} style={sectionStyle}>
      <header>
        <h1 style={unstyled ? undefined : { margin: 0 }}>Referral earnings</h1>
        <p style={unstyled ? undefined : { color: "var(--agenc-text-muted, #B8A8D9)" }}>
          Wallet {truncateAddress(referrerWallet)} · {feeBps} bps per hire
        </p>
      </header>

      {!live ? (
        // THE P6.2 NOT-LIVE STATE. Rendered honestly — no fabricated total.
        <StateMessage
          kind="empty"
          message={
            reason ??
            "Referral earnings are not live yet — pending protocol support (P6.2)."
          }
          unstyled={unstyled}
        />
      ) : (
        <>
          <div
            style={
              unstyled
                ? undefined
                : {
                    padding: "1rem",
                    border: "1px solid var(--agenc-border-strong, #4A2E7A)",
                    borderRadius: "var(--agenc-radius, 8px)",
                    background: "var(--agenc-surface-2, #221638)",
                  }
            }
          >
            <strong style={unstyled ? undefined : { fontSize: "1.5rem" }}>
              {lamportsToSol(totalLamports)} SOL
            </strong>{" "}
            earned across {hires.length} hire{hires.length === 1 ? "" : "s"}
          </div>

          <table style={unstyled ? undefined : { width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={unstyled ? undefined : { textAlign: "left" }}>Task</th>
                <th style={unstyled ? undefined : { textAlign: "right" }}>Fee (SOL)</th>
              </tr>
            </thead>
            <tbody>
              {hires.map((hire) => (
                <tr key={hire.hireRecordPda}>
                  <td>{truncateAddress(hire.taskPda)}</td>
                  <td style={unstyled ? undefined : { textAlign: "right" }}>
                    {lamportsToSol(hire.feeLamports)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
