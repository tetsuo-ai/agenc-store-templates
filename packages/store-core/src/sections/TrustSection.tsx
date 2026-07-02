/**
 * `<TrustSection>` — the `/trust` explainer (PLAN_2 C3). What protects the
 * buyer: escrow, completion bonds, disputes; the moderation policy; and the fee
 * disclosure (protocol + operator + THIS store's referral bps + wallet), which
 * mirrors the B2 widget disclosure so the earning party is always visible. Links
 * to the credible-exit doc (PLAN.md P8.6).
 *
 * Uses `ReferrerDisclosure` for the store-fee line — referral settlement is
 * live on-chain, so a configured referrer renders the present-tense copy.
 *
 * @module sections/TrustSection
 */
import type { ReactElement, ReactNode } from "react";
import {
  ReferrerDisclosure,
  truncateAddress,
  type ValidatedReferrerConfig,
} from "@tetsuo-ai/marketplace-react";

/** The default credible-exit doc URL (PLAN.md P8.6). */
export const DEFAULT_CREDIBLE_EXIT_HREF =
  "https://github.com/tetsuo-ai/agenc-protocol/blob/main/docs/CREDIBLE_EXIT.md";

/** Props for {@link TrustSection}. */
export interface TrustSectionProps {
  /** Store display name. */
  storeName: string;
  /**
   * The store's validated referrer config. When present, the fee disclosure
   * names the earning wallet + bps. When absent, no referral fee is disclosed.
   */
  referrer?: ValidatedReferrerConfig | null;
  /**
   * Whether referral settlement is active for this store's hires (from
   * `resolveReferrerCapability()` — true whenever a validated referrer is
   * configured). Forwarded to `ReferrerDisclosure` so the copy stays honest.
   */
  referrerLive?: boolean;
  /** Link to the moderation policy. */
  moderationPolicyHref?: string;
  /** Link to the credible-exit doc. Defaults to {@link DEFAULT_CREDIBLE_EXIT_HREF}. */
  credibleExitHref?: string;
  /** Emit no theme classes (white-label). */
  unstyled?: boolean;
}

/** One trust pillar (heading + body). */
function Pillar({
  title,
  children,
  unstyled,
}: {
  title: string;
  children: ReactNode;
  unstyled?: boolean;
}): ReactElement {
  return (
    <div
      style={
        unstyled
          ? undefined
          : {
              padding: "1rem",
              border: "1px solid var(--agenc-border, #2E1A4A)",
              borderRadius: "var(--agenc-radius, 8px)",
              background: "var(--agenc-surface, #16102A)",
            }
      }
    >
      <h3 style={unstyled ? undefined : { marginTop: 0 }}>{title}</h3>
      <p style={unstyled ? undefined : { color: "var(--agenc-text-muted, #B8A8D9)", margin: 0 }}>
        {children}
      </p>
    </div>
  );
}

/**
 * The `/trust` explainer body.
 *
 * @param props - {@link TrustSectionProps}.
 */
export function TrustSection({
  storeName,
  referrer,
  referrerLive = false,
  moderationPolicyHref,
  credibleExitHref = DEFAULT_CREDIBLE_EXIT_HREF,
  unstyled,
}: TrustSectionProps): ReactElement {
  return (
    <section
      className={unstyled ? undefined : "agenc"}
      style={unstyled ? undefined : { display: "grid", gap: "1rem" }}
    >
      <header>
        <h1 style={unstyled ? undefined : { margin: 0 }}>How {storeName} protects you</h1>
      </header>

      <Pillar title="Escrow" unstyled={unstyled}>
        Every hire funds an on-chain escrow before work begins. The agent is paid
        only when you accept the result; until then the funds are held by the
        protocol, not the agent and not this store.
      </Pillar>

      <Pillar title="Completion bonds" unstyled={unstyled}>
        Agents post a completion bond that is slashed if they abandon or
        under-deliver an accepted hire — skin in the game backing every job.
      </Pillar>

      <Pillar title="Disputes" unstyled={unstyled}>
        If a result is wrong, you can reject it or open a dispute. Disputes are
        resolved by an assigned protocol resolver, not by this store.
      </Pillar>

      <Pillar title="Moderation" unstyled={unstyled}>
        Listings are gated on a CLEAN moderation attestation by default.{" "}
        {moderationPolicyHref ? (
          <a href={moderationPolicyHref} style={unstyled ? undefined : { color: "var(--agenc-cyan, #48C8EF)" }}>
            Read the moderation policy.
          </a>
        ) : null}
      </Pillar>

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
        <h3 style={unstyled ? undefined : { marginTop: 0 }}>Fees</h3>
        <p style={unstyled ? undefined : { color: "var(--agenc-text-muted, #B8A8D9)" }}>
          Every hire pays the protocol fee and, where applicable, the listing
          operator fee.
          {referrer ? (
            <>
              {" "}
              This store ({storeName}) also earns a{" "}
              <strong>{referrer.feeBps} bps</strong> referral fee, paid to wallet{" "}
              <code>{truncateAddress(referrer.wallet)}</code>.
            </>
          ) : (
            " This store does not add a referral fee."
          )}
        </p>
        {referrer ? (
          <ReferrerDisclosure
            referrer={referrer}
            live={referrerLive}
            unstyled={unstyled}
          />
        ) : null}
        <p style={unstyled ? undefined : { color: "var(--agenc-text-muted, #B8A8D9)" }}>
          <a href={credibleExitHref} style={unstyled ? undefined : { color: "var(--agenc-cyan, #48C8EF)" }}>
            Read the credible-exit guarantee
          </a>{" "}
          — how your funds stay recoverable even if this store goes away.
        </p>
      </div>
    </section>
  );
}
