import Link from "next/link";
import { redirect } from "next/navigation";
import {
  TruckIcon,
  StorefrontIcon,
  StackIcon,
  SlidersHorizontalIcon,
  ArrowsLeftRightIcon,
  ClipboardTextIcon,
  PackageIcon,
  WarningIcon,
  CurrencyCircleDollarIcon,
  MagnifyingGlassIcon,
  ArrowUUpLeftIcon,
  FireIcon,
} from "@phosphor-icons/react/dist/ssr";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";

const QUICK_LINKS = [
  { href: "/gate/log-entry", label: "Gate Log", description: "Log a vehicle/goods entry or exit (Step 1).", icon: ClipboardTextIcon },
  { href: "/receiving", label: "Receiving Reports", description: "Draft, count, inspect, approve, and post incoming deliveries.", icon: TruckIcon },
  { href: "/retail", label: "Retail Sales", description: "Ring up a counter sale at list price and post it to the ledger.", icon: StorefrontIcon },
  { href: "/inventory/transfer", label: "Counter Replenishment", description: "Move stock from Storage to the Counter location.", icon: ArrowsLeftRightIcon },
  { href: "/adjustments", label: "Adjustments", description: "Request, investigate, approve, and post stock corrections.", icon: SlidersHorizontalIcon },
  { href: "/wholesale", label: "Wholesale Orders", description: "Reserve, pick, blind-check, authorize, and release orders.", icon: StackIcon },
  { href: "/returns", label: "Customer Returns", description: "Issue a Return Authorization and log its blind double-count.", icon: ArrowUUpLeftIcon },
  { href: "/disposal", label: "Damage & Disposal", description: "Report damage, create disposal certificates, and post their outcomes.", icon: FireIcon },
  { href: "/discrepancy-cases", label: "Discrepancy Cases", description: "Assign an owner and resolve open investigations.", icon: MagnifyingGlassIcon },
] as const;

export default async function OverviewPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");
  const branchId = session.user.branchId;
  if (!branchId) throw new Error("Signed-in user has no branch assigned.");

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [pendingReceiving, openWholesale, pendingAdjustments, monthlyPostedSales] = await Promise.all([
    prisma.receivingReport.count({
      where: { branchId, status: { notIn: ["POSTED", "VOID"] } },
    }),
    prisma.salesOrder.count({
      where: { branchId, status: { notIn: ["RELEASED", "VOID"] } },
    }),
    prisma.adjustmentRequest.count({
      where: { branchId, status: { notIn: ["POSTED", "REJECTED", "VOID"] } },
    }),
    prisma.retailSale.findMany({
      where: { branchId, status: "POSTED", createdAt: { gte: monthStart } },
      select: { lines: { select: { quantity: true, unitPrice: true } } },
    }),
  ]);

  const monthlyRevenue = monthlyPostedSales.reduce(
    (sum, sale) => sum + sale.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0),
    0,
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Overview</h1>
        <p className="text-sm text-slate-500">Signed in as {session.user.name} ({session.user.role})</p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Pending Receiving"
          value={pendingReceiving}
          sublabel="Reports not yet posted"
          accent={pendingReceiving > 0 ? "warning" : "brand"}
          icon={<PackageIcon size={18} weight="bold" />}
        />
        <StatCard
          label="Open Wholesale Orders"
          value={openWholesale}
          sublabel="Not yet fully released"
          accent={openWholesale > 0 ? "info" : "brand"}
          icon={<StackIcon size={18} weight="bold" />}
        />
        <StatCard
          label="Pending Adjustments"
          value={pendingAdjustments}
          sublabel="Awaiting investigation/approval"
          accent={pendingAdjustments > 0 ? "critical" : "brand"}
          icon={<WarningIcon size={18} weight="bold" />}
        />
        <StatCard
          label="This Month Retail Revenue"
          value={`₱${monthlyRevenue.toFixed(2)}`}
          sublabel="Posted counter sales"
          accent="brand"
          icon={<CurrencyCircleDollarIcon size={18} weight="bold" />}
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
