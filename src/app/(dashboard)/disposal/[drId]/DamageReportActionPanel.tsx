"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type BranchUser = { id: string; fullName: string; role: string };
type CurrentUser = { id: string; role: string };

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

const DISPOSITIONS = ["DESTROY", "SCRAP_SALE", "RETURN_TO_SUPPLIER", "SELL_AS_SECONDS"] as const;

export function DamageReportActionPanel({
  report,
  remaining,
  branchUsers,
  currentUser,
}: {
  report: { id: string; status: string };
  remaining: number;
  branchUsers: BranchUser[];
  currentUser: CurrentUser;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disposition, setDisposition] = useState<(typeof DISPOSITIONS)[number]>("DESTROY");
  const [quantity, setQuantity] = useState("");
  const [witness1Id, setWitness1Id] = useState(branchUsers[0]?.id ?? "");
  const [witness2Id, setWitness2Id] = useState(branchUsers[1]?.id ?? branchUsers[0]?.id ?? "");

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

  if (report.status === "REPORTED" && currentUser.role === "WAREHOUSE_SUPERVISOR") {
    cards.push(
      <ActionCard key="investigate" title="Record cause investigation">
        <button
          disabled={pending}
          onClick={() => run(() => postJson(`/api/v1/disposal/reports/${report.id}/investigate`, {}))}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Mark investigated
        </button>
      </ActionCard>,
    );
  }

  const canCreateCertificate =
    remaining > 0 &&
    report.status !== "DISPOSED" &&
    report.status !== "CLOSED" &&
    (currentUser.role === "WAREHOUSE_SUPERVISOR" || currentUser.role === "BRANCH_MANAGER");

  if (canCreateCertificate) {
    cards.push(
      <ActionCard key="certificate" title="Create disposal certificate">
        <div className="mb-3">
          <label className="mb-1 block text-sm text-slate-700">Disposition</label>
          <select
            value={disposition}
            onChange={(e) => setDisposition(e.target.value as typeof disposition)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none"
          >
            {DISPOSITIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-sm text-slate-700">Quantity (remaining undisposed: {remaining})</label>
          <input
            type="number"
            step="any"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none"
          />
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-sm text-slate-700">Witness 1</label>
          <select value={witness1Id} onChange={(e) => setWitness1Id(e.target.value)} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none">
            {branchUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({u.role})
              </option>
            ))}
          </select>
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-sm text-slate-700">Witness 2 (must not be a warehouse role — independent perspective)</label>
          <select value={witness2Id} onChange={(e) => setWitness2Id(e.target.value)} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none">
            {branchUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({u.role})
              </option>
            ))}
          </select>
        </div>
        <button
          disabled={pending || !quantity || !witness1Id || !witness2Id}
          onClick={() =>
            run(async () => {
              const cert = (await postJson("/api/v1/disposal/certificates", {
                damageReportId: report.id,
                disposition,
                quantity: Number(quantity),
                witness1Id,
                witness2Id,
              })) as { id: string };
              router.push(`/disposal/certificates/${cert.id}`);
            })
          }
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Create certificate
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
