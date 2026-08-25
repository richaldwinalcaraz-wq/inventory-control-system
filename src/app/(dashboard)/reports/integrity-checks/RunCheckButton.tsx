"use client";

import { useState } from "react";

type CheckResultItem = {
  id: string;
  referenceType: string;
  referenceId: string;
  notes?: string | null;
};

export function RunCheckButton({ endpoint, label }: { endpoint: string; label: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CheckResultItem[] | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Check failed.");
        setResults(null);
        return;
      }
      setResults(json.data ?? []);
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
      >
        {pending ? "Running…" : label}
      </button>

      {error ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {results !== null ? (
        results.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No items flagged.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {results.map((r) => (
              <li key={r.id} className="rounded-md bg-slate-50 px-3 py-2">
                <span className="font-medium">
                  {r.referenceType} {r.referenceId}
                </span>
                {r.notes ? <span className="text-slate-500"> — {r.notes}</span> : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
