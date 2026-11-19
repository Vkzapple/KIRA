import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
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
  title: "GRENVIS - Pemantauan Tanaman",
  description:
    "Pantau kesehatan tanaman Sekolah Adiwiyata dan kendalikan robot GRENVIS.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={`${display.variable} ${body.variable}`}>
      <body className="font-sans">
        <RobotProvider>
          <Navbar />
          <main>{children}</main>
        </RobotProvider>
      </body>
    </html>
  );
}
