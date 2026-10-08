/** Calls a /api/v1 route and returns `data`, or throws with the server's own error message. */
export async function sendJson<T = unknown>(url: string, method: "POST" | "PATCH", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? "Something went wrong. Please try again.");
  return json?.data as T;
}

/** "" -> null so an emptied optional field is saved as cleared. */
export const orNull = (value: string) => (value.trim() === "" ? null : value.trim());

export const inputClass = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600";
export const labelClass = "mb-1 block text-sm font-medium text-slate-700";
export const primaryButton = "rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50";
export const secondaryButton = "rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
export const dangerButton = "rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50";
