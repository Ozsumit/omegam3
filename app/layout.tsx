import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type React from "react"; // Import React
import { Analytics } from "@vercel/analytics/next";
const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "P2P File Transfer",
  description: "A simple P2P file transfer application",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <Analytics />
      <body className={inter.className}>{children}</body>
    </html>
  );
}
