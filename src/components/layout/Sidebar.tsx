"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HouseIcon,
  ClipboardTextIcon,
  TruckIcon,
  StorefrontIcon,
  StackIcon,
  SlidersHorizontalIcon,
  ArrowsLeftRightIcon,
  MagnifyingGlassIcon,
  ArrowUUpLeftIcon,
  FireIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon as IconType } from "@phosphor-icons/react";
import { NAV_ITEMS } from "./nav-items";

const ICONS: Record<string, IconType> = {
  "/": HouseIcon,
  "/gate/log-entry": ClipboardTextIcon,
  "/receiving": TruckIcon,
  "/retail": StorefrontIcon,
  "/wholesale": StackIcon,
  "/returns": ArrowUUpLeftIcon,
  "/disposal": FireIcon,
  "/adjustments": SlidersHorizontalIcon,
  "/inventory/transfer": ArrowsLeftRightIcon,
  "/discrepancy-cases": MagnifyingGlassIcon,
};

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col bg-brand-950 text-brand-50">
      <div className="flex items-center gap-2 px-6 py-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-500 text-brand-950">
          <StackIcon size={20} weight="bold" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight text-white">Inventory Control</p>
          <p className="text-xs leading-tight text-brand-300">System</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        <p className="px-3 pb-2 pt-2 text-xs font-semibold uppercase tracking-wide text-brand-400">
          Main
        </p>
        {NAV_ITEMS.map(({ href, label, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          const NavIcon = ICONS[href] ?? StackIcon;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-brand-500 text-brand-950"
                  : "text-brand-100 hover:bg-brand-900"
              }`}
            >
              <NavIcon size={18} weight={active ? "bold" : "regular"} />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
