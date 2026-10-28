import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-space", weight: ["400", "500", "600", "700"] });
const body = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-plex", weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-mono-plex", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "M-PESA Intelligence Platform",
  description:
    "Production-oriented real-time financial intelligence for M-PESA transaction ecosystems: event streaming, lakehouse engineering, ensemble fraud detection, customer analytics, predictive modelling and interactive business intelligence.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-ink text-chalk font-sans antialiased">{children}</body>
    </html>
  );
}
