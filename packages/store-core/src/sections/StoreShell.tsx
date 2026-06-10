/**
 * `<StoreShell>` — the shared layout shell every template wraps its pages in
 * (PLAN_2 C3). Header (brand + nav), the optional `PoweredByAgenC` footer (which
 * doubles as the referral disclosure), and a content slot. Branding colors from
 * the config are projected onto the `--agenc-*` token contract so the whole
 * subtree restyles with no recompile.
 *
 * Presentational + SSR-safe. The `<AgencProvider>` is mounted ABOVE this by the
 * template (it needs to be a client boundary); the shell itself is server-safe.
 *
 * @module sections/StoreShell
 */
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { PoweredByAgenC } from "@tetsuo-ai/marketplace-react";
import type { BrandingColors } from "../config/schema.js";

/** Map config branding colors onto the `--agenc-*` CSS custom properties. */
export function brandingColorVars(colors?: BrandingColors): CSSProperties {
  if (!colors) return {};
  const vars: Record<string, string> = {};
  if (colors.primary) vars["--agenc-violet"] = colors.primary;
  if (colors.secondary) vars["--agenc-magenta"] = colors.secondary;
  if (colors.background) vars["--agenc-void"] = colors.background;
  if (colors.surface) vars["--agenc-surface"] = colors.surface;
  if (colors.text) vars["--agenc-text"] = colors.text;
  return vars as CSSProperties;
}

/** A single nav link. */
export interface StoreNavLink {
  href: string;
  label: string;
}

/** Props for {@link StoreShell}. */
export interface StoreShellProps {
  /** Store display name (wordmark fallback when no logo). */
  storeName: string;
  /** Logo URL, when configured. */
  logo?: string;
  /** Branding color overrides (projected onto `--agenc-*`). */
  colors?: BrandingColors;
  /** Font-family override. */
  font?: string;
  /** Show the PoweredByAgenC footer (referral disclosure). Default true. */
  poweredBy?: boolean;
  /** The store's `/trust` page href (the PoweredBy + disclosure link). */
  trustHref?: string;
  /** Top nav links. */
  nav?: StoreNavLink[];
  /** Optional owner banner slot (e.g. the C7 `<UpdateBanner>`). */
  banner?: ReactNode;
  /** Page content. */
  children: ReactNode;
  /** Emit no theme classes (white-label). */
  unstyled?: boolean;
}

const DEFAULT_NAV: StoreNavLink[] = [
  { href: "/", label: "Catalog" },
  { href: "/dashboard", label: "My tasks" },
  { href: "/trust", label: "Trust" },
];

/**
 * The shared store layout shell.
 *
 * @param props - {@link StoreShellProps}.
 */
export function StoreShell({
  storeName,
  logo,
  colors,
  font,
  poweredBy = true,
  trustHref = "/trust",
  nav = DEFAULT_NAV,
  banner,
  children,
  unstyled,
}: StoreShellProps): ReactElement {
  const rootClass = unstyled ? undefined : "agenc agenc-store-shell";
  const rootStyle: CSSProperties = unstyled
    ? {}
    : {
        ...brandingColorVars(colors),
        ...(font ? { fontFamily: font } : {}),
        minHeight: "100vh",
        background: "var(--agenc-void, #0A0612)",
        color: "var(--agenc-text, #F5F0FF)",
        display: "flex",
        flexDirection: "column",
      };

  return (
    <div className={rootClass} style={rootStyle}>
      <header
        style={
          unstyled
            ? undefined
            : {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "1rem 1.5rem",
                borderBottom: "1px solid var(--agenc-border, #2E1A4A)",
              }
        }
      >
        <a
          href="/"
          style={
            unstyled
              ? undefined
              : { display: "flex", alignItems: "center", gap: "0.5rem", color: "inherit", textDecoration: "none" }
          }
        >
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={storeName} height={28} />
          ) : (
            <strong style={unstyled ? undefined : { fontSize: "1.1rem" }}>{storeName}</strong>
          )}
        </a>
        <nav
          style={
            unstyled ? undefined : { display: "flex", gap: "1.25rem", alignItems: "center" }
          }
        >
          {nav.map((link) => (
            <a
              key={link.href}
              href={link.href}
              style={unstyled ? undefined : { color: "var(--agenc-text-muted, #B8A8D9)", textDecoration: "none" }}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </header>

      {banner ? (
        <div style={unstyled ? undefined : { padding: "0.75rem 1.5rem 0" }}>{banner}</div>
      ) : null}

      <main
        style={
          unstyled
            ? undefined
            : { flex: 1, padding: "1.5rem", maxWidth: "72rem", width: "100%", margin: "0 auto" }
        }
      >
        {children}
      </main>

      {poweredBy ? (
        <footer
          style={
            unstyled
              ? undefined
              : {
                  padding: "1.5rem",
                  borderTop: "1px solid var(--agenc-border, #2E1A4A)",
                  display: "flex",
                  justifyContent: "center",
                }
          }
        >
          <PoweredByAgenC href={trustHref} unstyled={unstyled} />
        </footer>
      ) : null}
    </div>
  );
}
