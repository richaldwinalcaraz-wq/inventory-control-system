"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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

export function AdjustmentActionPanel({
  adjId,
  status,
  requestedBy,
  currentUser,
}: {
  adjId: string;
  status: string;
  requestedBy: string;
  currentUser: { id: string; role: string };
}) {
  const router = useRouter();
  const [investigationNotes, setInvestigationNotes] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [pinTokenId, setPinTokenId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
      setPinTokenId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  const isRequester = currentUser.id === requestedBy;
  const cards: React.ReactNode[] = [];

  if (status === "PENDING_INVESTIGATION" && (currentUser.role === "BRANCH_MANAGER" || currentUser.role === "AUDITOR") && !isRequester) {
    cards.push(
      <ActionCard key="investigate" title="Investigate">
        <textarea
          value={investigationNotes}
          onChange={(e) => setInvestigationNotes(e.target.value)}
          rows={3}
          placeholder="What the investigation found"
          className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
        <div className="flex gap-2">
          <button
            disabled={pending || !investigationNotes}
            onClick={() => run(() => postJson(`/api/v1/adjustments/${adjId}/investigate`, { outcome: "PROCEED", investigationNotes }))}
            className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
          >
            Proceed to approval
          </button>
          <button
            disabled={pending || !investigationNotes}
            onClick={() => run(() => postJson(`/api/v1/adjustments/${adjId}/investigate`, { outcome: "RESOLVED_WITHOUT_ADJUSTMENT", investigationNotes }))}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Resolved — no adjustment needed
          </button>
        </div>
      </ActionCard>,
    );
  }

  if (status === "PENDING_APPROVAL" && (currentUser.role === "BRANCH_MANAGER" || currentUser.role === "OWNER") && !isRequester) {
    cards.push(
      <ActionCard key="approve" title="Approve">
        <PinTokenField tokenId={pinTokenId} onTokenIssued={setPinTokenId} />
        <div className="mt-3 flex gap-2">
          <button
            disabled={pending || !pinTokenId}
            onClick={() => run(() => postJson(`/api/v1/adjustments/${adjId}/approve`, { outcome: "APPROVE", pinTokenId }))}
            className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            disabled={pending}
            onClick={() => run(() => postJson(`/api/v1/adjustments/${adjId}/approve`, { outcome: "REJECT" }))}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          If this account&apos;s role doesn&apos;t match the required approval tier for the requester&apos;s current rolling 7-day
          total, approval will be rejected server-side.
        </p>
      </ActionCard>,
    );
  }

  if (status === "APPROVED" && currentUser.role === "ENCODER") {
    cards.push(
      <ActionCard key="post" title="Post to ledger">
        <PinTokenField tokenId={pinTokenId} onTokenIssued={setPinTokenId} />
        <button
          disabled={pending || !pinTokenId}
          onClick={() => run(() => postJson(`/api/v1/adjustments/${adjId}/post`, { pinTokenId }))}
          className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Post adjustment
        </button>
      </ActionCard>,
    );
  }

  if (status === "POSTED") {
    cards.push(
      <ActionCard key="posted" title="Posted">
        <p className="text-sm text-green-700">This adjustment has been posted to the stock ledger and is now permanently immutable (A-7).</p>
      </ActionCard>,
    );
  }
  if (status === "REJECTED") {
    cards.push(
      <ActionCard key="rejected" title="Rejected">
        <p className="text-sm text-slate-500">This request was rejected or resolved without an adjustment.</p>
      </ActionCard>,
    );
  }
  if (status === "VOID") {
    cards.push(
      <ActionCard key="void-status" title="Void">
        <p className="text-sm text-slate-500">This adjustment request has been voided.</p>
      </ActionCard>,
    );
  }

  const canVoid = (currentUser.role === "BRANCH_MANAGER" || currentUser.role === "OWNER") && status !== "POSTED" && status !== "VOID";
  if (canVoid) {
    cards.push(
      <ActionCard key="void" title="Void this request">
        <input
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
          placeholder="Reason"
          className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
        <button
          disabled={pending || !voidReason}
          onClick={() => run(() => postJson(`/api/v1/adjustments/${adjId}/void`, { reason: voidReason }))}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Void
        </button>
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
