export const NAV_ITEMS = [
  { href: "/", label: "Overview", exact: true },
  { href: "/gate/log-entry", label: "Gate Log", exact: true },
  { href: "/receiving", label: "Receiving", exact: false },
  { href: "/retail", label: "Retail Sales", exact: false },
  { href: "/wholesale", label: "Wholesale", exact: false },
  { href: "/returns", label: "Returns", exact: false },
  { href: "/disposal", label: "Damage & Disposal", exact: false },
  { href: "/adjustments", label: "Adjustments", exact: false },
  { href: "/inventory/transfer", label: "Counter Transfer", exact: true },
  { href: "/discrepancy-cases", label: "Discrepancy Cases", exact: false },
] as const;

/** Best-match nav label for a given pathname — longest matching href wins so detail routes (e.g. /receiving/abc) still resolve to "Receiving". */
export function breadcrumbLabel(pathname: string): string {
  if (pathname === "/") return "Overview";
  const match = [...NAV_ITEMS]
    .filter((item) => item.href !== "/" && pathname.startsWith(item.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? "Inventory System";
}
