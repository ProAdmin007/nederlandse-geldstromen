import type { Metadata, Viewport } from "next";
import "./globals.css";

const description =
  "Hoeveel geld stroomt er vanuit Nederland naar andere landen, en andersom? Handel, hulp, EU, pensioenen en Big Tech, met bron bij elk bedrag.";

export const metadata: Metadata = {
  // Absolute basis voor deelafbeeldingen; zet NEXT_PUBLIC_SITE_URL bij het publiceren.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://proadmin007.github.io"),
  title: "Nederlandse Geldstromen",
  description,
  openGraph: {
    title: "Nederlandse Geldstromen",
    description,
    type: "website",
    locale: "nl_NL",
    siteName: "Nederlandse Geldstromen",
    images: [{ url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/og.png`, width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", title: "Nederlandse Geldstromen", description, images: [`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/og.png`] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
