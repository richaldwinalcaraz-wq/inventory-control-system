"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AssignableUser = { id: string; fullName: string; role: string };

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

export function DiscrepancyCaseActionPanel({
  caseId,
  status,
  assignedTo,
  currentUser,
  assignableUsers,
}: {
  caseId: string;
  status: string;
  assignedTo: string | null;
  currentUser: { role: string };
  assignableUsers: AssignableUser[];
}) {
  const router = useRouter();
  const [assignee, setAssignee] = useState(assignableUsers[0]?.id ?? "");
  const [resolution, setResolution] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = currentUser.role === "BRANCH_MANAGER" || currentUser.role === "AUDITOR" || currentUser.role === "OWNER";

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

  if (status === "CLOSED") {
    return <p className="text-sm text-slate-500">This case is closed.</p>;
  }

  if (!canManage) {
    return <p className="text-sm text-slate-500">No action available for your role.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <ActionCard title={assignedTo ? "Reassign owner" : "Assign owner"}>
        <select
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        >
          {assignableUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName} ({u.role})
            </option>
          ))}
        </select>
        <button
          disabled={pending || !assignee}
          onClick={() => run(() => postJson(`/api/v1/discrepancy-cases/${caseId}/assign`, { assignedTo: assignee }))}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {assignedTo ? "Reassign" : "Assign"}
        </button>
      </ActionCard>

      <ActionCard title="Close case">
        <textarea
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          rows={3}
          placeholder="Resolution — what was found and how it was resolved"
          className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
        <button
          disabled={pending || !resolution.trim() || !assignedTo}
          onClick={() => run(() => postJson(`/api/v1/discrepancy-cases/${caseId}/close`, { resolution }))}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Close case
        </button>
        {!assignedTo ? <p className="mt-2 text-xs text-slate-500">An owner must be assigned before this case can be closed.</p> : null}
      </ActionCard>
    </div>
  );
}
