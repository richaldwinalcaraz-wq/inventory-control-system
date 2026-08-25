export const NAV_ITEMS = [
  { href: "/", label: "Overview", exact: true, section: "Main" },
  { href: "/gate/log-entry", label: "Gate Log", exact: true, section: "Main" },
  { href: "/receiving", label: "Receiving", exact: false, section: "Main" },
  { href: "/retail", label: "Retail Sales", exact: false, section: "Main" },
  { href: "/wholesale", label: "Wholesale", exact: false, section: "Main" },
  { href: "/returns", label: "Returns", exact: false, section: "Main" },
  { href: "/disposal", label: "Damage & Disposal", exact: false, section: "Main" },
  { href: "/adjustments", label: "Adjustments", exact: false, section: "Main" },
  { href: "/inventory/transfer", label: "Counter Transfer", exact: true, section: "Main" },
  { href: "/inventory", label: "Inventory", exact: true, section: "Reports" },
  { href: "/inventory/low-stock", label: "Low Stock Alerts", exact: true, section: "Reports" },
  { href: "/inventory/reorder-points", label: "Reorder Points", exact: true, section: "Reports" },
  { href: "/reports/daily-exception", label: "Daily Exception Report", exact: true, section: "Reports" },
  { href: "/reports/shrinkage-rate", label: "Shrinkage Rate", exact: true, section: "Reports" },
  { href: "/reports/damage-vs-shrinkage", label: "Damage vs. Shrinkage", exact: true, section: "Reports" },
  { href: "/reports/quarantine-disposal-aging", label: "Quarantine & Disposal Aging", exact: true, section: "Reports" },
  { href: "/reports/daily-stock-movement", label: "Daily Stock Movement", exact: true, section: "Reports" },
  { href: "/reports/variance-analysis", label: "Variance Analysis", exact: true, section: "Reports" },
  { href: "/reports/trend-review", label: "Trend Review", exact: true, section: "Reports" },
  { href: "/reports/integrity-checks", label: "Integrity Checks", exact: true, section: "Reports" },
] as const;

/** Best-match nav label for a given pathname — longest matching href wins so detail routes (e.g. /receiving/abc) still resolve to "Receiving". */
export function breadcrumbLabel(pathname: string): string {
  if (pathname === "/") return "Overview";
  const match = [...NAV_ITEMS]
    .filter((item) => item.href !== "/" && pathname.startsWith(item.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? "Inventory System";
}
