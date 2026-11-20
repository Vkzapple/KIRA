import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import Link from "next/link";
import { Leaf } from "lucide-react";
import "./globals.css";
import { RobotProvider } from "@/context/RobotContext";
import Navbar from "@/components/Navbar";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
});

const body = Figtree({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "KIRA - Pemantauan Tanaman",
  description:
    "Pantau kesehatan tanaman Sekolah Adiwiyata dan kendalikan robot KIRA.",
};

export const viewport: Viewport = {
  themeColor: "#0E0E10",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={`${display.variable} ${body.variable}`}>
      <body className="flex min-h-screen flex-col font-sans">
        <RobotProvider>
          <Navbar />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-white/5">
            <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-cream/55 lg:flex-row lg:items-center lg:justify-between">
              <p className="flex items-center gap-2">
                <Leaf className="size-4 text-olive-400" aria-hidden="true" />
                KIRA &middot; Robot pemantau tanaman Sekolah Adiwiyata
              </p>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link
                  href="/"
                  className="transition-colors hover:text-cream/80"
                >
                  Beranda
                </Link>
                <span aria-hidden="true" className="text-cream/20">
                  /
                </span>
                <Link
                  href="/controller"
                  className="transition-colors hover:text-cream/80"
                >
                  Controller
                </Link>
                <span aria-hidden="true" className="text-cream/20">
                  /
                </span>
                <span className="font-mono text-xs text-cream/45">
                  ESP32 &middot; Go &middot; Next.js
                </span>
              </p>
            </div>
          </footer>
        </RobotProvider>
      </body>
    </html>
  );
}
