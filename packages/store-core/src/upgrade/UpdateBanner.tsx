/**
 * `<UpdateBanner>` — the owner-visible staleness banner (PLAN_2 C7). Renders
 * NOTHING when the instance is current; renders an update notice (security
 * updates flagged conspicuously) linking to the changelog when behind.
 *
 * Presentational + themed via the `--agenc-*` tokens (the same contract
 * `marketplace-react` uses); accepts `unstyled` for white-label. SSR-safe.
 *
 * @module upgrade/UpdateBanner
 */
import type { ReactElement } from "react";
import type { StalenessResult } from "./staleness.js";

/** Props for {@link UpdateBanner}. */
export interface UpdateBannerProps {
  /** The staleness verdict (from `useChangelogFeed` / `checkStaleness`). */
  staleness: StalenessResult | null;
  /** URL the "view changelog" link points at. */
  changelogUrl?: string;
  /** Emit no theme classes (white-label). */
  unstyled?: boolean;
  /** Extra class on the root. */
  className?: string;
}

const ROOT_CLASS = "agenc";

/**
 * Render the owner-visible update banner. Returns `null` (renders nothing) when
 * `staleness` is null or not stale.
 *
 * @param props - {@link UpdateBannerProps}.
 */
export function UpdateBanner({
  staleness,
  changelogUrl,
  unstyled,
  className,
}: UpdateBannerProps): ReactElement | null {
  if (!staleness || !staleness.stale) return null;

  const rootClass = unstyled
    ? className
    : [ROOT_CLASS, "agenc-update-banner", className]
        .filter((part): part is string => Boolean(part && part.trim() !== ""))
        .join(" ");

  const headline = staleness.security
    ? "Security update available"
    : "Update available";

  const detail = staleness.storeCoreBehind
    ? `Your store is on store-core ${staleness.installedStoreCoreVersion}; ${staleness.currentStoreCoreVersion} is available.`
    : "A protocol surface update is available for this store.";

  return (
    <div
      role="status"
      aria-live="polite"
      data-security={staleness.security ? "true" : "false"}
      className={rootClass}
      style={
        unstyled
          ? undefined
          : {
              padding: "0.75rem 1rem",
              borderRadius: "var(--agenc-radius, 8px)",
              border: `1px solid ${staleness.security ? "var(--agenc-danger, #FF3D3D)" : "var(--agenc-border-strong, #4A2E7A)"}`,
              background: "var(--agenc-surface-2, #221638)",
              color: "var(--agenc-text, #F5F0FF)",
              display: "flex",
              gap: "0.75rem",
              alignItems: "center",
              justifyContent: "space-between",
            }
      }
    >
      <span>
        <strong>{headline}</strong>{" "}
        <span style={unstyled ? undefined : { color: "var(--agenc-text-muted, #B8A8D9)" }}>
          {detail} Update is a dependency bump + redeploy — no template-code
          merge.
        </span>
      </span>
      {changelogUrl ? (
        <a
          href={changelogUrl}
          target="_blank"
          rel="noreferrer"
          style={
            unstyled
              ? undefined
              : { color: "var(--agenc-cyan, #48C8EF)", whiteSpace: "nowrap" }
          }
        >
          View changelog
        </a>
      ) : null}
    </div>
  );
}
