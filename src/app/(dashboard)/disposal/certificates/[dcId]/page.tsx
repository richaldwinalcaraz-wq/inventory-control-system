import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { CertificateActionPanel } from "./CertificateActionPanel";
import { DISPOSAL_CERTIFICATE_STATUS_TONE } from "../../status";

export default async function DisposalCertificateDetailPage({ params }: { params: Promise<{ dcId: string }> }) {
  const { dcId } = await params;
  const session = await getAppSession();
  if (!session) redirect("/login");

  const cert = await prisma.disposalCertificate.findUnique({
    where: { id: dcId },
    include: {
      damageReport: {
        select: { id: true, cause: true, productVariant: { select: { sku: true, product: { select: { name: true } } } } },
      },
      documentNumber: { select: { fullNumber: true } },
      scrapSaleRecord: true,
    },
  });
  if (!cert) notFound();

  const witnesses = await prisma.user.findMany({
    where: { id: { in: [cert.witness1Id, cert.witness2Id] } },
    select: { id: true, fullName: true },
  });
  const witnessName = (id: string) => witnesses.find((w) => w.id === id)?.fullName ?? id.slice(0, 8);

  const benchmarks =
    cert.disposition === "SCRAP_SALE"
      ? await prisma.scrapBuyerBenchmark.findMany({ orderBy: { buyerName: "asc" }, select: { id: true, buyerName: true, benchmarkRatePerKg: true } })
      : [];

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">
          Disposal Certificate — {cert.damageReport.productVariant.sku} ({cert.disposition})
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <StatusBadge label={cert.status} tone={DISPOSAL_CERTIFICATE_STATUS_TONE[cert.status] ?? "neutral"} />
          {cert.documentNumber ? <>Document #: {cert.documentNumber.fullNumber}</> : null}
        </p>
      </div>

      <div className="mb-6 rounded-lg border border-slate-200 p-4 text-sm">
        <dl className="grid grid-cols-2 gap-y-2">
          <dt className="text-slate-500">Product</dt>
          <dd>{cert.damageReport.productVariant.product.name}</dd>
          <dt className="text-slate-500">Damage report</dt>
          <dd>
            <Link href={`/disposal/${cert.damageReport.id}`} className="text-brand-700 hover:underline">
              {cert.damageReport.cause}
            </Link>
          </dd>
          <dt className="text-slate-500">Quantity</dt>
          <dd>{cert.quantity.toString()}</dd>
          <dt className="text-slate-500">Value at cost</dt>
          <dd>{Number(cert.valueAtCost).toFixed(2)}</dd>
          <dt className="text-slate-500">Witness 1</dt>
          <dd>{witnessName(cert.witness1Id)}</dd>
          <dt className="text-slate-500">Witness 2</dt>
          <dd>{witnessName(cert.witness2Id)}</dd>
        </dl>
      </div>

      <CertificateActionPanel
        cert={{ id: cert.id, disposition: cert.disposition, status: cert.status }}
        scrapSaleRecord={
          cert.scrapSaleRecord
            ? { belowBenchmark: cert.scrapSaleRecord.belowBenchmark, ownerApprovedBy: cert.scrapSaleRecord.ownerApprovedBy }
            : null
        }
        benchmarks={benchmarks.map((b) => ({ id: b.id, label: `${b.buyerName} — ₱${Number(b.benchmarkRatePerKg).toFixed(2)}/kg` }))}
        currentUser={{ id: session.user.id, role: session.user.role }}
      />
    </div>
  );
}
