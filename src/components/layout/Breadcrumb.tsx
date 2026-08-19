"use client";

import { usePathname } from "next/navigation";
import { breadcrumbLabel } from "./nav-items";

export function Breadcrumb() {
  const pathname = usePathname();
  return (
    <p className="text-sm text-slate-500">
      <span className="text-slate-400">Inventory System</span>
      <span className="mx-2 text-slate-300">/</span>
      <span className="font-medium text-slate-900">{breadcrumbLabel(pathname)}</span>
    </p>
  );
}
