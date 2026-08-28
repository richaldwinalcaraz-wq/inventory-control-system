import Link from "next/link";
import { redirect } from "next/navigation";
import {
  TruckIcon,
  PackageIcon,
  WarningIcon,
  FireIcon,
  ClipboardTextIcon,
  ChartLineIcon,
} from "@phosphor-icons/react/dist/ssr";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";
import { computeLowStockAlerts } from "@/server/application/reporting/lowStockAlerts";

const QUICK_LINKS = [
  { href: "/inventory", label: "Inventory", description: "Current stock on hand, by product and branch.", icon: PackageIcon },
  { href: "/inventory/low-stock", label: "Low Stock Alerts", description: "Products at or below their reorder point.", icon: WarningIcon },
  { href: "/inventory/reorder-points", label: "Reorder Points", description: "Set the per-product reorder threshold used by alerts.", icon: ClipboardTextIcon },
  { href: "/receiving", label: "Receiving Reports", description: "Draft, count, inspect, approve, and post incoming deliveries.", icon: TruckIcon },
  { href: "/disposal", label: "Damage & Disposal", description: "Report damage, create disposal certificates, and post their outcomes.", icon: FireIcon },
  { href: "/reports/daily-exception", label: "Daily Exception Report", description: "Today's exceptions across receiving, sales, and adjustments.", icon: ChartLineIcon },
  { href: "/reports/shrinkage-rate", label: "Shrinkage Rate", description: "Shrinkage rate by branch over a selected period.", icon: ChartLineIcon },
] as const;

export default async function OverviewPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");
  const branchId = session.user.branchId;
  if (!branchId) throw new Error("Signed-in user has no branch assigned.");

  const [pendingReceiving, openDamageReports, lowStockAlerts] = await Promise.all([
    prisma.receivingReport.count({
      where: { branchId, status: { notIn: ["POSTED", "VOID"] } },
    }),
    prisma.damageReport.count({
      where: { branchId, status: { notIn: ["DISPOSED", "CLOSED"] } },
    }),
    computeLowStockAlerts(prisma, { branchId }),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Overview</h1>
        <p className="text-sm text-slate-500">Signed in as {session.user.name} ({session.user.role})</p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Pending Receiving"
          value={pendingReceiving}
          sublabel="Reports not yet posted"
          accent={pendingReceiving > 0 ? "warning" : "brand"}
          icon={<PackageIcon size={18} weight="bold" />}
        />
        <StatCard
          label="Open Damage Reports"
          value={openDamageReports}
          sublabel="Not yet disposed/closed"
          accent={openDamageReports > 0 ? "critical" : "brand"}
          icon={<FireIcon size={18} weight="bold" />}
        />
        <StatCard
          label="Low Stock Items"
          value={lowStockAlerts.length}
          sublabel="At or below reorder point"
          accent={lowStockAlerts.length > 0 ? "warning" : "brand"}
          icon={<WarningIcon size={18} weight="bold" />}
        />
      </div>

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Quick Actions</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_LINKS.map(({ href, label, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex flex-col gap-2 rounded-lg border border-slate-200 p-4 hover:border-brand-400 hover:bg-brand-50"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-50 text-brand-700 group-hover:bg-brand-100">
                <Icon size={18} weight="bold" />
              </div>
              <h3 className="font-medium text-slate-900">{label}</h3>
              <p className="text-sm text-slate-500">{description}</p>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
