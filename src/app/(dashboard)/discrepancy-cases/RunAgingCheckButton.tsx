"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RunAgingCheckButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<number | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    setOpened(null);
    try {
      const res = await fetch("/api/v1/discrepancy-cases/check-aging", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Could not run the aging check.");
        return;
      }
      setOpened(Array.isArray(json.data) ? json.data.length : 0);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={pending}
        className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
      >
        {pending ? "Checking…" : "Run Quarantine/Disposal Aging Check"}
      </button>
      {opened !== null ? <p className="text-xs text-slate-500">{opened} new case(s) opened.</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
