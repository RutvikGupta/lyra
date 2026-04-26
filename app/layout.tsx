import type { Metadata } from "next";
import { Geist, Geist_Mono, Unbounded } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Wordmark / display font for the "Lyra" brand and big headlines.
// Unbounded is a quirky, geometric display sans — readable at small sizes
// but distinctive in heavier weights.
const unbounded = Unbounded({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "700", "800"],
});

export const metadata: Metadata = {
  title: "Lyra",
  description:
    "Lyra — your Spotify listening history as a 3D starfield, with live now-playing overlay.",
  applicationName: "Lyra",
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#050d09",
  viewportFit: "cover" as const,
};

// Spotify OAuth requires `127.0.0.1` (not `localhost`) since Nov 2025.
// Cookies set on `localhost` aren't visible on `127.0.0.1`, so any user
// who lands on localhost would fail the PKCE callback. Server-side
// redirect doesn't work because Turbopack normalizes localhost ≡ 127.0.0.1
// as same-origin and strips the host. So: tiny pre-hydration client script.
const LOCALHOST_REDIRECT = `
if (location.hostname === 'localhost') {
  location.replace(location.href.replace('//localhost', '//127.0.0.1'));
}`.trim();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${unbounded.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: LOCALHOST_REDIRECT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
