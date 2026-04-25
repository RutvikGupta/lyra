import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Listening Web",
  description: "A 3D starfield of your Spotify listening history",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: LOCALHOST_REDIRECT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
