import { notFound, redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ReturnActionPanel } from "./ReturnActionPanel";
import { RETURN_STATUS_TONE } from "../status";

export default async function ReturnDetailPage({ params }: { params: Promise<{ raId: string }> }) {
  const { raId } = await params;
  const session = await getAppSession();
  if (!session) redirect("/login");

  const ra = await prisma.returnAuthorization.findUnique({
    where: { id: raId },
    include: {
      documentNumber: { select: { fullNumber: true } },
      productVariant: { select: { sku: true, product: { select: { name: true } } } },
    },
  });
  if (!ra) notFound();

  const countSlips = await prisma.countSlip.findMany({
    where: { referenceType: "ReturnAuthorization", referenceId: raId },
    select: { id: true, role: true, countedBy: true, countedAt: true },
  });
  const hasReceiveSlip = countSlips.some((s) => s.role === "RETURN_RECEIVE");
  const hasCheckSlip = countSlips.some((s) => s.role === "RETURN_CHECK");

  // Blind-view discipline: while grading is still in progress (not GRADED/
  // GRADING_DISPUTED yet), only the COUNT and whether the current user
  // already graded are ever sent to the client — never the actual grade
  // value, which would defeat the second grader's blindness.
  const gradings = await prisma.returnGrading.findMany({
    where: { returnAuthorizationId: raId },
    orderBy: { graderSeq: "asc" },
    select: { graderSeq: true, gradedBy: true, grade: true, notes: true, gradedAt: true },
  });
  const gradingRevealed = ra.status === "GRADED" || ra.status === "GRADING_DISPUTED" || ra.status === "REJECTED_NOT_OURS";

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">
          Return Authorization — {ra.productVariant.sku} ({ra.reasonCode})
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <StatusBadge label={ra.status} tone={RETURN_STATUS_TONE[ra.status] ?? "neutral"} />
          {ra.isHighRisk ? <StatusBadge label="High risk" tone="critical" /> : null}
          {ra.documentNumber ? <>Document #: {ra.documentNumber.fullNumber}</> : null}
        </p>
      </div>

      <div className="mb-6 rounded-lg border border-slate-200 p-4 text-sm">
        <dl className="grid grid-cols-2 gap-y-2">
          <dt className="text-slate-500">Product</dt>
          <dd>{ra.productVariant.product.name}</dd>
          <dt className="text-slate-500">Original sale</dt>
          <dd>
            {ra.originalSaleType} — {ra.originalSaleLineId.slice(0, 8)}
          </dd>
          <dt className="text-slate-500">Requested quantity</dt>
          <dd>{ra.requestedQty.toString()}</dd>
          <dt className="text-slate-500">Identity verification</dt>
          <dd>{ra.identityVerification}</dd>
          <dt className="text-slate-500">Expires</dt>
          <dd>{ra.expiresAt.toISOString().slice(0, 10)}</dd>
          {ra.finalGrade ? (
            <>
              <dt className="text-slate-500">Final grade</dt>
              <dd>{ra.finalGrade}</dd>
            </>
          ) : null}
        </dl>
      </div>

      {gradingRevealed && gradings.length > 0 ? (
        <div className="mb-6 rounded-lg border border-slate-200 p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Gradings</h2>
          <ul className="flex flex-col gap-1">
            {gradings.map((g) => (
              <li key={g.graderSeq}>
                Grader {g.graderSeq}: {g.grade} {g.notes ? `— ${g.notes}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ReturnActionPanel
        ra={{ id: ra.id, status: ra.status }}
        flags={{
          hasReceiveSlip,
          hasCheckSlip,
          gradingCount: gradings.length,
          alreadyGradedByMe: gradings.some((g) => g.gradedBy === session.user.id),
        }}
        currentUser={{ id: session.user.id, role: session.user.role }}
      />
    </div>
  );
}
