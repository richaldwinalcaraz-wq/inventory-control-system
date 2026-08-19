"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CameraCapture } from "@/components/CameraCapture";
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

export function CertificateActionPanel({
  cert,
  scrapSaleRecord,
  benchmarks,
  currentUser,
}: {
  cert: { id: string; disposition: string; status: string };
  scrapSaleRecord: { belowBenchmark: boolean; ownerApprovedBy: string | null } | null;
  benchmarks: Array<{ id: string; label: string }>;
  currentUser: { id: string; role: string };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidencePhotos, setEvidencePhotos] = useState<string[]>([]);
  const [pinTokenId, setPinTokenId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const [buyerName, setBuyerName] = useState("");
  const [pricePerKg, setPricePerKg] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [justification, setJustification] = useState<"quotes" | "benchmark">("benchmark");
  const [scrapBuyerBenchmarkId, setScrapBuyerBenchmarkId] = useState(benchmarks[0]?.id ?? "");
  const [quote1Name, setQuote1Name] = useState("");
  const [quote1Price, setQuote1Price] = useState("");
  const [quote2Name, setQuote2Name] = useState("");
  const [quote2Price, setQuote2Price] = useState("");
  const [quoteEvidencePhotos, setQuoteEvidencePhotos] = useState<string[]>([]);

  const [vehiclePlate, setVehiclePlate] = useState("");
  const [driverName, setDriverName] = useState("");

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
  const canActAsSupervisor = currentUser.role === "WAREHOUSE_SUPERVISOR";

  if (cert.disposition === "DESTROY" && cert.status === "DRAFT" && canActAsSupervisor) {
    cards.push(
      <ActionCard key="evidence" title="Record destruction evidence">
        <p className="mb-3 text-xs text-slate-500">A live-captured photo showing the destroyed/unsellable state is required before this certificate can move to posting.</p>
        <CameraCapture photos={evidencePhotos} onChange={setEvidencePhotos} />
        <button
          disabled={pending || evidencePhotos.length === 0}
          onClick={() => run(() => postJson(`/api/v1/disposal/certificates/${cert.id}/destroy/evidence`, { evidencePhotoDataUrls: evidencePhotos }))}
          className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Attach evidence
        </button>
      </ActionCard>,
    );
  }

  if (cert.disposition === "DESTROY" && cert.status === "FOR_DISPOSAL" && canActAsSupervisor) {
    cards.push(
      <ActionCard key="post-destroy" title="Post destruction">
        <PinTokenField tokenId={pinTokenId} onTokenIssued={setPinTokenId} />
        <button
          disabled={pending || !pinTokenId}
          onClick={() => run(() => postJson(`/api/v1/disposal/certificates/${cert.id}/destroy/post`, { pinTokenId }))}
          className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Post destruction
        </button>
      </ActionCard>,
    );
  }

  if (cert.disposition === "SELL_AS_SECONDS" && cert.status === "DRAFT" && canActAsSupervisor) {
    cards.push(
      <ActionCard key="sell-as-seconds" title="Post transfer to sellable stock (Seconds)">
        <PinTokenField tokenId={pinTokenId} onTokenIssued={setPinTokenId} />
        <button
          disabled={pending || !pinTokenId}
          onClick={() => run(() => postJson(`/api/v1/disposal/certificates/${cert.id}/sell-as-seconds`, { pinTokenId }))}
          className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Post
        </button>
      </ActionCard>,
    );
  }

  if (cert.disposition === "SCRAP_SALE" && cert.status === "DRAFT" && !scrapSaleRecord && canActAsSupervisor) {
    cards.push(
      <ActionCard key="scrap-quote" title="Record scrap sale">
        <div className="mb-3">
          <label className="mb-1 block text-sm text-slate-700">Buyer name</label>
          <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none" />
        </div>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm text-slate-700">Price / kg</label>
            <input type="number" step="any" min="0" value={pricePerKg} onChange={(e) => setPricePerKg(e.target.value)} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-700">Weight (kg)</label>
            <input type="number" step="any" min="0" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none" />
          </div>
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-sm text-slate-700">Justification (one path required)</label>
          <select
            value={justification}
            onChange={(e) => setJustification(e.target.value as typeof justification)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none"
          >
            <option value="benchmark">Matched scrap-buyer benchmark</option>
            <option value="quotes">Two comparative quotes on file</option>
          </select>
        </div>

        {justification === "benchmark" ? (
          <div className="mb-3">
            <label className="mb-1 block text-sm text-slate-700">Benchmark</label>
            {benchmarks.length === 0 ? (
              <p className="text-xs text-amber-700">No scrap-buyer benchmarks configured — use quotes instead.</p>
            ) : (
              <select
                value={scrapBuyerBenchmarkId}
                onChange={(e) => setScrapBuyerBenchmarkId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none"
              >
                {benchmarks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : (
          <div className="mb-3">
            <div className="grid grid-cols-2 gap-3">
              <input placeholder="Quote 1 buyer" value={quote1Name} onChange={(e) => setQuote1Name(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none" />
              <input type="number" step="any" min="0" placeholder="Quote 1 ₱/kg" value={quote1Price} onChange={(e) => setQuote1Price(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none" />
              <input placeholder="Quote 2 buyer" value={quote2Name} onChange={(e) => setQuote2Name(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none" />
              <input type="number" step="any" min="0" placeholder="Quote 2 ₱/kg" value={quote2Price} onChange={(e) => setQuote2Price(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none" />
            </div>
            <p className="mb-1 mt-3 text-xs text-slate-500">A live-captured photo of the quote document(s) is required for this path — no way to skip the benchmark check without it.</p>
            <CameraCapture photos={quoteEvidencePhotos} onChange={setQuoteEvidencePhotos} />
          </div>
        )}

        <button
          disabled={
            pending ||
            !buyerName ||
            !pricePerKg ||
            !weightKg ||
            (justification === "quotes" && quoteEvidencePhotos.length === 0)
          }
          onClick={() =>
            run(() =>
              postJson(`/api/v1/disposal/certificates/${cert.id}/scrap-sale/quote`, {
                buyerName,
                pricePerKg: Number(pricePerKg),
                weightKg: Number(weightKg),
                scrapBuyerBenchmarkId: justification === "benchmark" ? scrapBuyerBenchmarkId : undefined,
                quotesOnFile:
                  justification === "quotes" && quote1Name && quote1Price && quote2Name && quote2Price
                    ? [
                        { buyerName: quote1Name, pricePerKg: Number(quote1Price) },
                        { buyerName: quote2Name, pricePerKg: Number(quote2Price) },
                      ]
                    : undefined,
                quoteEvidencePhotoDataUrls: justification === "quotes" ? quoteEvidencePhotos : [],
              }),
            )
          }
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Record scrap sale
        </button>
      </ActionCard>,
    );
  }

  if (cert.disposition === "SCRAP_SALE" && cert.status === "DRAFT" && scrapSaleRecord?.belowBenchmark && !scrapSaleRecord.ownerApprovedBy && currentUser.role === "OWNER") {
    cards.push(
      <ActionCard key="scrap-approve" title="Approve below-benchmark scrap sale">
        <PinTokenField tokenId={pinTokenId} onTokenIssued={setPinTokenId} />
        <button
          disabled={pending || !pinTokenId}
          onClick={() => run(() => postJson(`/api/v1/disposal/certificates/${cert.id}/scrap-sale/approve`, { pinTokenId }))}
          className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Approve
        </button>
      </ActionCard>,
    );
  }

  const scrapReadyToPost = scrapSaleRecord && (!scrapSaleRecord.belowBenchmark || !!scrapSaleRecord.ownerApprovedBy);
  if (cert.disposition === "SCRAP_SALE" && cert.status === "DRAFT" && scrapReadyToPost && canActAsSupervisor) {
    cards.push(
      <ActionCard key="scrap-post" title="Post scrap sale">
        <PinTokenField tokenId={pinTokenId} onTokenIssued={setPinTokenId} />
        <button
          disabled={pending || !pinTokenId}
          onClick={() => run(() => postJson(`/api/v1/disposal/certificates/${cert.id}/scrap-sale/post`, { pinTokenId }))}
          className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Post
        </button>
      </ActionCard>,
    );
  }

  if (cert.disposition === "RETURN_TO_SUPPLIER" && cert.status === "DRAFT" && canActAsSupervisor) {
    cards.push(
      <ActionCard key="return-to-supplier" title="Post return to supplier">
        <div className="mb-3 grid grid-cols-2 gap-3">
          <input placeholder="Vehicle plate (optional)" value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none" />
          <input placeholder="Driver name (optional)" value={driverName} onChange={(e) => setDriverName(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none" />
        </div>
        <PinTokenField tokenId={pinTokenId} onTokenIssued={setPinTokenId} />
        <button
          disabled={pending || !pinTokenId}
          onClick={() =>
            run(() =>
              postJson(`/api/v1/disposal/certificates/${cert.id}/return-to-supplier`, {
                pinTokenId,
                vehiclePlate: vehiclePlate || undefined,
                driverName: driverName || undefined,
              }),
            )
          }
          className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Post return to supplier
        </button>
      </ActionCard>,
    );
  }

  if ((cert.status === "DRAFT" || cert.status === "FOR_DISPOSAL") && (currentUser.role === "BRANCH_MANAGER" || currentUser.role === "OWNER")) {
    cards.push(
      <ActionCard key="void" title="Void this certificate">
        <input
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
          placeholder="Reason"
          className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
        <button
          disabled={pending || !voidReason}
          onClick={() => run(() => postJson(`/api/v1/disposal/certificates/${cert.id}/void`, { reason: voidReason }))}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Void
        </button>
      </ActionCard>,
    );
  }

  if (cert.status === "POSTED" || cert.status === "VOID") {
    cards.push(
      <ActionCard key="closed" title={cert.status}>
        <p className="text-sm text-slate-500">This certificate is no longer actionable.</p>
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
