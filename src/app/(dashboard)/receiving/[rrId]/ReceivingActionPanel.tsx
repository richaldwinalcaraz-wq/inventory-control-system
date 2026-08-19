"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CameraCapture } from "@/components/CameraCapture";
import { PinTokenField } from "@/components/PinTokenField";

interface RRLine {
  productVariantId: string;
  sku: string;
}
interface RR {
  id: string;
  status: string;
  receivedBy: string;
  poReference: string | null;
  supplierCallbackConfirmedAt: string | null;
  lines: RRLine[];
}
interface Flags {
  hasReceiverSlip: boolean;
  hasCheckerSlip: boolean;
  hasTieBreakSlip: boolean;
  needsTieBreak: boolean;
}
interface CurrentUser {
  id: string;
  role: string;
}
interface BranchUser {
  id: string;
  fullName: string;
  role: string;
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? "Request failed.");
  return json.data;
}

function QtyLinesInput({ lines, values, onChange }: { lines: RRLine[]; values: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {lines.map((l) => (
        <div key={l.productVariantId} className="flex items-center gap-3">
          <span className="w-40 text-sm text-slate-700">{l.sku}</span>
          <input
            type="number"
            step="any"
            required
            value={values[l.productVariantId] ?? ""}
            onChange={(e) => onChange({ ...values, [l.productVariantId]: e.target.value })}
            className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none"
          />
        </div>
      ))}
    </div>
  );
}

function ActionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </div>
  );
}

export function ReceivingActionPanel({
  rr,
  flags,
  currentUser,
  branchUsers,
}: {
  rr: RR;
  flags: Flags;
  currentUser: CurrentUser;
  branchUsers: BranchUser[];
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [witnessedBy, setWitnessedBy] = useState(branchUsers[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinTokenId, setPinTokenId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [voidReason, setVoidReason] = useState("");

  function refresh() {
    router.refresh();
  }

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
      setQty({});
      setPinTokenId(null);
      setPhotos([]);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  const linesForQty = (values: Record<string, string>) =>
    rr.lines.map((l) => ({ productVariantId: l.productVariantId, countedQty: Number(values[l.productVariantId] ?? 0) }));

  const canVoid = (currentUser.role === "WAREHOUSE_SUPERVISOR" || currentUser.role === "OWNER") && rr.status !== "POSTED" && rr.status !== "VOID";

  const cards: React.ReactNode[] = [];

  if (rr.status === "DRAFT" && !flags.hasReceiverSlip && currentUser.role === "WAREHOUSE_RECEIVER") {
    cards.push(
      <ActionCard key="receiver-count" title="Step 4 — Submit your count (Receiver)">
        <QtyLinesInput lines={rr.lines} values={qty} onChange={setQty} />
        <button
          disabled={pending}
          onClick={() => run(() => postJson(`/api/v1/receiving/${rr.id}/count/receiver`, { lines: linesForQty(qty) }))}
          className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Submit receiver count
        </button>
      </ActionCard>,
    );
  }

  if (rr.status === "DRAFT" && flags.hasReceiverSlip && !flags.hasCheckerSlip && currentUser.role === "WAREHOUSE_CHECKER") {
    cards.push(
      <ActionCard key="checker-count" title="Step 5 — Submit your count (Checker, blind)">
        <p className="mb-2 text-xs text-slate-500">You will not see the receiver&apos;s figures — count independently.</p>
        <QtyLinesInput lines={rr.lines} values={qty} onChange={setQty} />
        <button
          disabled={pending}
          onClick={() => run(() => postJson(`/api/v1/receiving/${rr.id}/count/checker`, { lines: linesForQty(qty) }))}
          className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Submit checker count
        </button>
      </ActionCard>,
    );
  }

  if (rr.status === "DRAFT" && flags.needsTieBreak && currentUser.role === "WAREHOUSE_SUPERVISOR") {
    cards.push(
      <ActionCard key="tiebreak" title="Step 5 — Tie-break (counts disagreed)">
        <div className="mb-3">
          <label className="mb-1 block text-sm text-slate-700">Witnessed by</label>
          <select value={witnessedBy} onChange={(e) => setWitnessedBy(e.target.value)} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none">
            {branchUsers.filter((u) => u.id !== currentUser.id).map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({u.role})
              </option>
            ))}
          </select>
        </div>
        <QtyLinesInput lines={rr.lines} values={qty} onChange={setQty} />
        <button
          disabled={pending}
          onClick={() => run(() => postJson(`/api/v1/receiving/${rr.id}/count/tiebreak`, { witnessedBy, lines: linesForQty(qty) }))}
          className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Submit tie-break count
        </button>
      </ActionCard>,
    );
  }

  if (rr.status === "PENDING_INSPECTION" && (currentUser.role === "WAREHOUSE_RECEIVER" || currentUser.role === "WAREHOUSE_SUPERVISOR")) {
    cards.push(
      <ActionCard key="inspect" title="Step 6 — Quality inspection">
        <div className="flex gap-2">
          <button
            disabled={pending}
            onClick={() => run(() => postJson(`/api/v1/receiving/${rr.id}/inspect`, { outcome: "PASS" }))}
            className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
          >
            Pass
          </button>
          {currentUser.role === "WAREHOUSE_SUPERVISOR" ? (
            <button
              disabled={pending}
              onClick={() => run(() => postJson(`/api/v1/receiving/${rr.id}/inspect`, { outcome: "REJECT" }))}
              className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
            >
              Reject (quarantine)
            </button>
          ) : null}
        </div>
      </ActionCard>,
    );
  }

  if (rr.status === "PENDING_VERIFICATION" && currentUser.role === "WAREHOUSE_SUPERVISOR") {
    const isReceiver = rr.receivedBy === currentUser.id;
    cards.push(
      <ActionCard key="verify" title="Steps 7–8 — Prepare & verify">
        {isReceiver ? (
          <p className="text-sm text-red-600">You received this delivery and cannot verify it yourself.</p>
        ) : (
          <button
            disabled={pending}
            onClick={() =>
              run(async () => {
                await postJson(`/api/v1/receiving/${rr.id}/prepare`, {});
                await postJson(`/api/v1/receiving/${rr.id}/verify`, {});
              })
            }
            className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
          >
            Verify receiving report
          </button>
        )}
      </ActionCard>,
    );
  }

  if (rr.status === "PENDING_APPROVAL") {
    const needsCallback = !rr.poReference && !rr.supplierCallbackConfirmedAt;
    if (needsCallback && (currentUser.role === "WAREHOUSE_RECEIVER" || currentUser.role === "WAREHOUSE_SUPERVISOR")) {
      cards.push(
        <ActionCard key="callback" title="G-04 — Confirm supplier call-back">
          <p className="mb-2 text-xs text-slate-500">No PO is on file. Call the supplier back on the number on file, then confirm here.</p>
          <button
            disabled={pending}
            onClick={() => run(() => postJson(`/api/v1/receiving/${rr.id}/callback`, {}))}
            className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
          >
            Confirm call-back completed
          </button>
        </ActionCard>,
      );
    }
    if (!needsCallback && (currentUser.role === "BRANCH_MANAGER" || currentUser.role === "OWNER")) {
      cards.push(
        <ActionCard key="approve" title="Step 9 — Approve">
          <PinTokenField tokenId={pinTokenId} onTokenIssued={setPinTokenId} />
          <button
            disabled={pending || !pinTokenId}
            onClick={() => run(() => postJson(`/api/v1/receiving/${rr.id}/approve`, { pinTokenId }))}
            className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
          >
            Approve
          </button>
        </ActionCard>,
      );
    }
  }

  if (rr.status === "APPROVED" && currentUser.role === "ENCODER") {
    cards.push(
      <ActionCard key="encode" title="Step 10 — Encode & post">
        <div className="mb-4">
          <CameraCapture photos={photos} onChange={setPhotos} />
        </div>
        <PinTokenField tokenId={pinTokenId} onTokenIssued={setPinTokenId} />
        <button
          disabled={pending || !pinTokenId || photos.length === 0}
          onClick={() => run(() => postJson(`/api/v1/receiving/${rr.id}/encode`, { pinTokenId, evidencePhotoDataUrls: photos }))}
          className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Post to ledger
        </button>
      </ActionCard>,
    );
  }

  if (rr.status === "POSTED") {
    cards.push(
      <ActionCard key="posted" title="Posted">
        <p className="text-sm text-green-700">This receiving report has been posted to the stock ledger.</p>
      </ActionCard>,
    );
  }
  if (rr.status === "QUARANTINE" && (currentUser.role === "WAREHOUSE_SUPERVISOR" || currentUser.role === "BRANCH_MANAGER" || currentUser.role === "OWNER")) {
    cards.push(
      <ActionCard key="quarantine" title="Quarantined">
        <p className="mb-3 text-sm text-slate-600">
          Goods were rejected at inspection. Exiting quarantine lets this report continue through verification, approval, and
          encoding — quarantined lines post into the QUARANTINE zone (not RECEIVING/STORAGE), so they stay physically
          segregated with a real stock balance until a Damage &amp; Disposal decision is made.
        </p>
        <button
          disabled={pending}
          onClick={() => run(() => postJson(`/api/v1/receiving/${rr.id}/exit-quarantine`, {}))}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Exit quarantine — proceed to verification
        </button>
      </ActionCard>,
    );
  }
  if (rr.status === "VOID") {
    cards.push(
      <ActionCard key="void-status" title="Void">
        <p className="text-sm text-slate-500">This receiving report has been voided.</p>
      </ActionCard>,
    );
  }

  if (canVoid) {
    cards.push(
      <ActionCard key="void" title="Void this receiving report">
        <input
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
          placeholder="Reason"
          className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
        <button
          disabled={pending || !voidReason}
          onClick={() => run(() => postJson(`/api/v1/receiving/${rr.id}/void`, { reason: voidReason }))}
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
      {cards.length === 0 ? (
        <p className="text-sm text-slate-500">No action available for your role at this stage.</p>
      ) : (
        cards
      )}
    </div>
  );
}
