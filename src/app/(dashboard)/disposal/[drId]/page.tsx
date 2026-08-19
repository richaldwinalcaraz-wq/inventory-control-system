import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DamageReportActionPanel } from "./DamageReportActionPanel";
import { DAMAGE_REPORT_STATUS_TONE, DISPOSAL_CERTIFICATE_STATUS_TONE } from "../status";

export default async function DamageReportDetailPage({ params }: { params: Promise<{ drId: string }> }) {
  const { drId } = await params;
  const session = await getAppSession();
  if (!session) redirect("/login");

  const report = await prisma.damageReport.findUnique({
    where: { id: drId },
    include: {
      productVariant: { select: { sku: true, product: { select: { name: true } } } },
      warehouseLocation: { select: { zone: true, code: true } },
      disposalCertificates: {
        orderBy: { createdAt: "desc" },
        select: { id: true, disposition: true, quantity: true, status: true, createdAt: true },
      },
    },
  });
  if (!report) notFound();

  const undisposedAgg = await prisma.disposalCertificate.aggregate({
    where: { damageReportId: drId, status: { not: "VOID" } },
    _sum: { quantity: true },
  });
  const remaining = Number(report.quantity) - Number(undisposedAgg._sum.quantity ?? 0);

  const users = await prisma.user.findMany({
    where: { branchId: report.branchId, status: "ACTIVE" },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, role: true },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">
          Damage Report — {report.productVariant.sku} ({report.sourceType})
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <StatusBadge label={report.status} tone={DAMAGE_REPORT_STATUS_TONE[report.status] ?? "neutral"} />
        </p>
      </div>

      <div className="mb-6 rounded-lg border border-slate-200 p-4 text-sm">
        <dl className="grid grid-cols-2 gap-y-2">
          <dt className="text-slate-500">Product</dt>
          <dd>{report.productVariant.product.name}</dd>
          <dt className="text-slate-500">Location</dt>
          <dd>
            {report.warehouseLocation.zone} ({report.warehouseLocation.code})
          </dd>
          <dt className="text-slate-500">Quantity reported</dt>
          <dd>{report.quantity.toString()}</dd>
          <dt className="text-slate-500">Remaining undisposed</dt>
          <dd>{remaining}</dd>
          <dt className="text-slate-500">Cause</dt>
          <dd>{report.cause}</dd>
          <dt className="text-slate-500">In quarantine since</dt>
          <dd>{report.quarantineEnteredAt.toISOString().slice(0, 10)}</dd>
        </dl>
      </div>

      {report.disposalCertificates.length > 0 ? (
        <div className="mb-6 rounded-lg border border-slate-200 p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Disposal Certificates</h2>
          <ul className="flex flex-col gap-1">
            {report.disposalCertificates.map((c) => (
              <li key={c.id} className="flex items-center justify-between">
                <Link href={`/disposal/certificates/${c.id}`} className="text-brand-700 hover:underline">
                  {c.disposition} — qty {c.quantity.toString()}
                </Link>
                <StatusBadge label={c.status} tone={DISPOSAL_CERTIFICATE_STATUS_TONE[c.status] ?? "neutral"} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <DamageReportActionPanel
        report={{ id: report.id, status: report.status }}
        remaining={remaining}
        branchUsers={users}
        currentUser={{ id: session.user.id, role: session.user.role }}
      />
    </div>
  );
}
