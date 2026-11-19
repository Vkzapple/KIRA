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
    <header className="sticky top-0 z-40 bg-forest-900 text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <Leaf className="size-6 text-sun" aria-hidden="true" />
          <span className="font-display text-xl font-bold tracking-wide">
            GRENVIS
          </span>
        </Link>

        <nav aria-label="Navigasi utama" className="order-3 flex w-full gap-1 sm:order-2 sm:w-auto">
          {links.map(({ href, label, icon: Icon, locked: isLocked }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-white text-forest-900"
                    : "text-white/80 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
                {isLocked && (
                  <Lock className="size-3.5 opacity-70" aria-label="Perlu koneksi robot" />
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
