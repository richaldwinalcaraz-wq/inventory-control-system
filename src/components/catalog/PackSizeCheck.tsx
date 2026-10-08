"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { inputClass, labelClass, primaryButton, secondaryButton, sendJson } from "@/app/(dashboard)/inventory/catalog/api";

export interface PackSizeCheckProps {
  conversionRateVersionId: string;
  /** "Sack" */
  unitName: string;
  /** "RIM" */
  baseUnitCode: string;
  rate: number;
  /** 1 when one person has already checked it. */
  checksDone: number;
}

/** "Confirm 40 RIM" / "Different count" for one pending pack size — a physical count, done by two people other than the proposer. */
export function PackSizeCheck({ conversionRateVersionId, unitName, baseUnitCode, rate, checksDone }: PackSizeCheckProps) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(url: string, body?: unknown) {
    setPending(true);
    setError(null);
    try {
      await sendJson(url, "POST", body);
      setRejecting(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => run(`/api/v1/catalog/pack-sizes/${conversionRateVersionId}/confirm`)} className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          I counted {rate} {baseUnitCode} in 1 {unitName}
        </button>
        <button type="button" disabled={pending} onClick={() => setRejecting(true)} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          Different count
        </button>
      </div>
      <span className="text-xs text-slate-500">Check {checksDone + 1} of 2. Open one {unitName.toLowerCase()} and count before confirming.</span>
      {error && !rejecting ? (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      ) : null}

      {rejecting ? (
        <Modal
          title={`How many ${baseUnitCode} were in 1 ${unitName}?`}
          onClose={() => setRejecting(false)}
          footer={
            <>
              <button type="button" onClick={() => setRejecting(false)} className={secondaryButton}>
                Cancel
              </button>
              <button type="submit" form={`reject-${conversionRateVersionId}`} disabled={pending} className={primaryButton}>
                {pending ? "Saving…" : "Report count"}
              </button>
            </>
          }
        >
          <form
            id={`reject-${conversionRateVersionId}`}
            onSubmit={(e) => {
              e.preventDefault();
              void run(`/api/v1/catalog/pack-sizes/${conversionRateVersionId}/reject`, { countedBaseQty: Number(counted), note: note.trim() || null });
            }}
            className="flex flex-col gap-4"
          >
            <p className="text-sm text-slate-700">
              The price list says {rate}. The Owner will see your count and set the right number, which then needs two checks again.
            </p>
            <div>
              <label htmlFor={`counted-${conversionRateVersionId}`} className={labelClass}>
                Counted {baseUnitCode} *
              </label>
              <input id={`counted-${conversionRateVersionId}`} type="number" min="0.0001" step="any" required value={counted} onChange={(e) => setCounted(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor={`note-${conversionRateVersionId}`} className={labelClass}>
                Note
              </label>
              <input id={`note-${conversionRateVersionId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={inputClass} />
            </div>
            {error ? (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
