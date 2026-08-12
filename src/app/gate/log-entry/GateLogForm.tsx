"use client";

import { useState } from "react";

export function GateLogForm() {
  const [direction, setDirection] = useState<"IN" | "OUT">("IN");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [driverName, setDriverName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/v1/gate-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, vehiclePlate: vehiclePlate || undefined, driverName: driverName || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Could not log this entry.");
        return;
      }
      setSuccess(true);
      setVehiclePlate("");
      setDriverName("");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Direction</label>
        <select value={direction} onChange={(e) => setDirection(e.target.value as "IN" | "OUT")} className="w-full rounded-md border border-slate-300 px-3 py-2">
          <option value="IN">IN</option>
          <option value="OUT">OUT</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Vehicle plate</label>
        <input value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Driver name</label>
        <input value={driverName} onChange={(e) => setDriverName(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" />
      </div>
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {success ? <p className="text-sm text-green-700">Logged.</p> : null}
      <button disabled={pending} type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-base font-medium text-white hover:bg-slate-800 disabled:opacity-50">
        {pending ? "Logging…" : "Log entry"}
      </button>
    </form>
  );
}
