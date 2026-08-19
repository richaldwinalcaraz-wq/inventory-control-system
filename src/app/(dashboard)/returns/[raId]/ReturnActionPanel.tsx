"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CameraCapture } from "@/components/CameraCapture";
import { PinTokenField } from "@/components/PinTokenField";

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? "Request failed.");
  return json.data;
}

function ActionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </div>
  );
}

const GRADES = ["SELLABLE", "REPACKABLE", "DAMAGED", "NOT_OURS"] as const;

export function ReturnActionPanel({
  ra,
  flags,
  currentUser,
}: {
  ra: { id: string; status: string };
  flags: { hasReceiveSlip: boolean; hasCheckSlip: boolean; gradingCount: number; alreadyGradedByMe: boolean };
  currentUser: { id: string; role: string };
}) {
  const router = useRouter();
  const [receiveQty, setReceiveQty] = useState("");
  const [checkQty, setCheckQty] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<boolean | null>(null);
  const [grade, setGrade] = useState<(typeof GRADES)[number]>("SELLABLE");
  const [gradeNotes, setGradeNotes] = useState("");
  const [gradePhotos, setGradePhotos] = useState<string[]>([]);
  const [finalGrade, setFinalGrade] = useState<(typeof GRADES)[number]>("SELLABLE");
  const [voidReason, setVoidReason] = useState("");
  const [pinTokenId, setPinTokenId] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  const cards: React.ReactNode[] = [];

  if (ra.status === "ISSUED" && currentUser.role === "WAREHOUSE_RECEIVER") {
    cards.push(
      <ActionCard key="receive" title="Log goods arrival">
        <button
          disabled={pending}
          onClick={() => run(() => postJson(`/api/v1/returns/${ra.id}/receive`, {}))}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Log goods received
        </button>
      </ActionCard>,
    );
  }

  if (ra.status === "ISSUED" && (currentUser.role === "BRANCH_MANAGER" || currentUser.role === "OWNER")) {
    cards.push(
      <ActionCard key="void" title="Void this RA">
        <input
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
          placeholder="Reason"
          className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
        <button
          disabled={pending || !voidReason}
          onClick={() => run(() => postJson(`/api/v1/returns/${ra.id}/void`, { reason: voidReason }))}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Void
        </button>
      </ActionCard>,
    );
  }

  if (ra.status === "GOODS_RECEIVED" && !flags.hasReceiveSlip && currentUser.role === "WAREHOUSE_RECEIVER") {
    cards.push(
      <ActionCard key="receive-count" title="Receiver count (blind)">
        <input
          type="number"
          step="any"
          min="0"
          value={receiveQty}
          onChange={(e) => setReceiveQty(e.target.value)}
          placeholder="Counted quantity"
          className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
        <button
          disabled={pending || !receiveQty}
          onClick={() => run(() => postJson(`/api/v1/returns/${ra.id}/count/receiver`, { countedQty: Number(receiveQty) }))}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Submit receiver count
        </button>
      </ActionCard>,
    );
  }

  if (ra.status === "GOODS_RECEIVED" && flags.hasReceiveSlip && !flags.hasCheckSlip && currentUser.role === "WAREHOUSE_CHECKER") {
    cards.push(
      <ActionCard key="check-count" title="Checker count (blind)">
        <input
          type="number"
          step="any"
          min="0"
          value={checkQty}
          onChange={(e) => setCheckQty(e.target.value)}
          placeholder="Counted quantity"
          className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
        <button
          disabled={pending || !checkQty}
          onClick={() =>
            run(async () => {
              const result = (await postJson(`/api/v1/returns/${ra.id}/count/checker`, { countedQty: Number(checkQty) })) as { matched: boolean };
              setMatchResult(result.matched);
            })
          }
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Submit checker count
        </button>
        {matchResult === false ? (
          <p className="mt-2 text-xs text-red-600">Counts did not match — a Discrepancy Case has been opened for Branch Manager reconciliation.</p>
        ) : null}
        {matchResult === true ? <p className="mt-2 text-xs text-green-700">Counts matched.</p> : null}
      </ActionCard>,
    );
  }

  const canGrade =
    ra.status === "GOODS_RECEIVED" &&
    flags.hasReceiveSlip &&
    flags.hasCheckSlip &&
    flags.gradingCount < 2 &&
    !flags.alreadyGradedByMe &&
    (currentUser.role === "WAREHOUSE_SUPERVISOR" || currentUser.role === "WAREHOUSE_CHECKER");

  if (canGrade) {
    cards.push(
      <ActionCard key="grade" title={flags.gradingCount === 0 ? "Grade this return" : "Grade this return (second, blind)"}>
        <select
          value={grade}
          onChange={(e) => setGrade(e.target.value as typeof grade)}
          className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        >
          {GRADES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <textarea
          value={gradeNotes}
          onChange={(e) => setGradeNotes(e.target.value)}
          rows={2}
          placeholder="Notes (optional)"
          className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
        {grade !== "SELLABLE" ? (
          <div className="mb-3">
            <CameraCapture photos={gradePhotos} onChange={setGradePhotos} />
          </div>
        ) : null}
        <button
          disabled={pending || (grade !== "SELLABLE" && gradePhotos.length === 0)}
          onClick={() =>
            run(() =>
              postJson(`/api/v1/returns/${ra.id}/grade`, {
                grade,
                notes: gradeNotes || undefined,
                evidencePhotoDataUrls: gradePhotos,
              }),
            )
          }
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Submit grading
        </button>
      </ActionCard>,
    );
  }

  if (ra.status === "GOODS_RECEIVED" && flags.hasReceiveSlip && flags.hasCheckSlip && !canGrade && flags.gradingCount < 2) {
    cards.push(
      <ActionCard key="wait-grade" title="Awaiting grading">
        <p className="text-sm text-slate-500">
          {flags.alreadyGradedByMe
            ? "You already submitted a grading for this RA — waiting on the second, independent grader."
            : "Both counts are on file. No grading action available for your role at this stage."}
        </p>
      </ActionCard>,
    );
  }

  if (ra.status === "GRADING_DISPUTED" && (currentUser.role === "BRANCH_MANAGER" || currentUser.role === "OWNER")) {
    cards.push(
      <ActionCard key="resolve-dispute" title="Resolve grading disagreement">
        <select
          value={finalGrade}
          onChange={(e) => setFinalGrade(e.target.value as typeof finalGrade)}
          className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        >
          {GRADES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <button
          disabled={pending}
          onClick={() => run(() => postJson(`/api/v1/returns/${ra.id}/resolve-dispute`, { finalGrade }))}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Set final grade
        </button>
      </ActionCard>,
    );
  }

  if (ra.status === "GRADED" && currentUser.role === "ENCODER") {
    cards.push(
      <ActionCard key="post" title="Post to ledger / disposal">
        <PinTokenField tokenId={pinTokenId} onTokenIssued={setPinTokenId} />
        <button
          disabled={pending || !pinTokenId}
          onClick={() => run(() => postJson(`/api/v1/returns/${ra.id}/post`, { pinTokenId }))}
          className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Post return
        </button>
      </ActionCard>,
    );
  }

  if (ra.status === "VOID" || ra.status === "EXPIRED" || ra.status === "REJECTED_NOT_OURS") {
    cards.push(
      <ActionCard key="closed" title={ra.status}>
        <p className="text-sm text-slate-500">This return authorization is no longer actionable.</p>
      </ActionCard>,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {cards.length === 0 ? <p className="text-sm text-slate-500">No action available for your role at this stage.</p> : cards}
    </div>
  );
}
