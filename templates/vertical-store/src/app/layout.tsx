/**
 * Root layout — mounts `<Providers>` (the AgenC context) above `<StoreShell>`
 * (header/nav/footer + the referral-disclosure PoweredBy footer) and the C7
 * owner-visible `<UpdateBanner>`. SSR-safe: the shell renders on the server; the
 * provider + banner are client boundaries.
 */
import type { Metadata } from "next";
import { storeMetadata } from "@tetsuo-ai/store-core/seo";
import { StoreShell } from "@/lib/sections";
import { storeConfig, seoContext } from "@/lib/config";
import { Providers } from "@/lib/providers";
import { StoreUpdateBanner } from "@/lib/update-banner";
import "./globals.css";

export const metadata: Metadata = storeMetadata(seoContext);

// An AgenC store renders the LIVE on-chain book through a client provider; there
// is nothing to statically prerender (and the not-found page must enter the
// provider's QueryClient boundary). Render every route dynamically.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nav = [
    { href: "/", label: "Catalog" },
    { href: "/dashboard", label: "My tasks" },
    { href: "/earnings", label: "Earnings" },
    { href: "/trust", label: "Trust" },
  ];

  return (
    <html lang="en">
      <body>
        <Providers>
          <StoreShell
            storeName={storeConfig.name}
            logo={storeConfig.branding.logo}
            colors={storeConfig.branding.colors}
            font={storeConfig.branding.font}
            poweredBy={storeConfig.branding.poweredBy}
            nav={nav}
            banner={<StoreUpdateBanner />}
          >
            {children}
          </StoreShell>
        </Providers>
      </body>
    </html>
  );
}
