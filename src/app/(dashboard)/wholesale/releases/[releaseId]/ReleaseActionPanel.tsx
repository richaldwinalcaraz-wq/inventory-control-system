"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PinTokenField } from "@/components/PinTokenField";

interface ReleaseData {
  id: string;
  status: string;
  weightCheckPassed: boolean | null;
  sealVerifiedIntact: boolean | null;
  podReturnedAt: boolean;
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? "Request failed.");
  return json.data;
}

function ActionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-slate-200 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </div>
  );
}

export function ReleaseActionPanel({ release, currentUser }: { release: ReleaseData; currentUser: { role: string } }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sealNumber, setSealNumber] = useState("");
  const [sealIntact, setSealIntact] = useState(true);
  const [actualWeightKg, setActualWeightKg] = useState("");
  const [pinTokenId, setPinTokenId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidPinTokenId, setVoidPinTokenId] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
      setPinTokenId(null);
      setVoidPinTokenId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  const cards: React.ReactNode[] = [];

  if (release.status === "PENDING_GATE_CHECK" && currentUser.role === "SECURITY_GUARD") {
    cards.push(
      <ActionCard key="gate" title="Gate check (outbound)">
        <div className="flex flex-col gap-2">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Seal number</label>
            <input value={sealNumber} onChange={(e) => setSealNumber(e.target.value)} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sealIntact} onChange={(e) => setSealIntact(e.target.checked)} />
            Seal verified intact
          </label>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Actual weight (kg)</label>
            <input type="number" step="any" value={actualWeightKg} onChange={(e) => setActualWeightKg(e.target.value)} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none" />
          </div>
        </div>
        <button
          disabled={pending || !sealNumber || !actualWeightKg}
          onClick={() =>
            run(() =>
              postJson(`/api/v1/releases/${release.id}/gate-check`, {
                sealNumber,
                sealVerifiedIntact: sealIntact,
                actualWeightKg: Number(actualWeightKg),
              }),
            )
          }
          className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Record Gate Check
        </button>
      </ActionCard>,
    );
  }

  if (release.status === "RELEASED" && currentUser.role === "ENCODER") {
    cards.push(
      <ActionCard key="post" title="Post to ledger">
        {!release.weightCheckPassed || !release.sealVerifiedIntact ? (
          <p className="mb-2 text-sm text-red-600">Weight check and/or seal verification did not pass — this release cannot be posted.</p>
        ) : null}
        <PinTokenField tokenId={pinTokenId} onTokenIssued={setPinTokenId} />
        <button
          disabled={pending || !pinTokenId || !release.weightCheckPassed || !release.sealVerifiedIntact}
          onClick={() => run(() => postJson(`/api/v1/releases/${release.id}/post`, { pinTokenId }))}
          className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Post Release
        </button>
      </ActionCard>,
    );
  }

  if (release.status === "POSTED") {
    cards.push(
      <ActionCard key="posted" title="Posted">
        <p className="mb-3 text-sm text-green-700">This release has been posted to the stock ledger.</p>
        {!release.podReturnedAt ? (
          <button disabled={pending} onClick={() => run(() => postJson(`/api/v1/releases/${release.id}/pod`, {}))} className="mr-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Record POD Returned
          </button>
        ) : (
          <p className="text-sm text-slate-500">POD returned.</p>
        )}
        <button disabled={pending} onClick={() => run(() => postJson(`/api/v1/releases/${release.id}/customer-confirm`, {}))} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          Record Customer Confirmation
        </button>
      </ActionCard>,
    );
  }

  const canVoid =
    (currentUser.role === "WAREHOUSE_SUPERVISOR" || currentUser.role === "BRANCH_MANAGER" || currentUser.role === "OWNER") &&
    release.status !== "POSTED" &&
    release.status !== "VOID";
  if (canVoid) {
    cards.push(
      <ActionCard key="void" title="Void this release">
        <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason" className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none" />
        <PinTokenField tokenId={voidPinTokenId} onTokenIssued={setVoidPinTokenId} />
        <button
          disabled={pending || !voidReason || !voidPinTokenId}
          onClick={() => run(() => postJson(`/api/v1/releases/${release.id}/void`, { reason: voidReason, pinTokenId: voidPinTokenId }))}
          className="mt-3 rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Void
        </button>
      </ActionCard>,
    );
  }

  if (release.status === "VOID") {
    cards.push(
      <ActionCard key="void-status" title="Void">
        <p className="text-sm text-slate-500">This release has been voided; its staged stock was returned to Storage.</p>
      </ActionCard>,
    );
  }

  return (
    <div className="flex flex-col">
      {error ? (
        <p className="mb-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {cards.length === 0 ? <p className="text-sm text-slate-500">No action available for your role at this stage.</p> : cards}
    </div>
  );
}
