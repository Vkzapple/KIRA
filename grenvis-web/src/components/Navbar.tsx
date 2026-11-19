"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gamepad2, Home, Leaf, Lock } from "lucide-react";
import { useRobot } from "@/context/RobotContext";
import ConnectionBadge from "./ConnectionBadge";

export default function Navbar() {
  const pathname = usePathname();
  const { status } = useRobot();
  const locked = status !== "connected";

  const links = [
    { href: "/", label: "Beranda", icon: Home, locked: false },
    { href: "/controller", label: "Controller", icon: Gamepad2, locked },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-ink/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
        <Link href="/" className="group flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gold text-ink shadow-glow transition-transform group-hover:-rotate-6">
            <Leaf className="size-5" aria-hidden="true" />
          </span>
          <span className="font-display text-xl font-bold tracking-[0.08em] text-cream">
            GRENVIS
          </span>
        </Link>

        <nav
          aria-label="Navigasi utama"
          className="order-3 flex w-full gap-1 rounded-full border border-white/5 bg-white/[0.03] p-1 sm:order-2 sm:w-auto"
        >
          {links.map(({ href, label, icon: Icon, locked: isLocked }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors sm:flex-none ${
                  active
                    ? "bg-gold text-ink"
                    : "text-cream/60 hover:bg-white/5 hover:text-cream"
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
                {isLocked && (
                  <Lock
                    className="size-3.5 opacity-70"
                    aria-label="Perlu koneksi robot"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="order-2 sm:order-3">
          <ConnectionBadge />
        </div>
      </div>
    </header>
  );
}
