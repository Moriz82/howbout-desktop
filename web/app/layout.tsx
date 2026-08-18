import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./howbout.css";

const title = "Howbout Desktop Companion";
const description = "A read-only home for your Howbout plans on macOS, Linux, and the web.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = forwardedHost || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const socialImage = `${origin}/og.png`;
  return {
    title,
    description,
    applicationName: "Howbout Companion",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Howbout" },
    icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
    openGraph: { title, description, type: "website", url: origin, images: [{ url: socialImage, width: 1200, height: 630, alt: "Howbout companion calendar" }] },
    twitter: { card: "summary_large_image", title, description, images: [socialImage] },
  };
}

export const viewport = { themeColor: "#c9ff38" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
