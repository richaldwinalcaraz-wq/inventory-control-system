import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";

export default async function HomePage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Inventory Control System</h1>
        <p className="text-slate-600">Signed in as {session.user.name} ({session.user.role})</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/gate/log-entry" className="rounded-lg border border-slate-200 p-5 hover:border-slate-400 hover:bg-slate-50">
          <h2 className="font-medium text-slate-900">Gate Log</h2>
          <p className="text-sm text-slate-500">Log a vehicle/goods entry or exit (Step 1).</p>
        </Link>
        <Link href="/receiving" className="rounded-lg border border-slate-200 p-5 hover:border-slate-400 hover:bg-slate-50">
          <h2 className="font-medium text-slate-900">Receiving Reports</h2>
          <p className="text-sm text-slate-500">Draft, count, inspect, approve, and post incoming deliveries.</p>
        </Link>
        <Link href="/retail" className="rounded-lg border border-slate-200 p-5 hover:border-slate-400 hover:bg-slate-50">
          <h2 className="font-medium text-slate-900">Retail Sales</h2>
          <p className="text-sm text-slate-500">Ring up a counter sale at list price and post it to the ledger.</p>
        </Link>
        <Link href="/inventory/transfer" className="rounded-lg border border-slate-200 p-5 hover:border-slate-400 hover:bg-slate-50">
          <h2 className="font-medium text-slate-900">Counter Replenishment</h2>
          <p className="text-sm text-slate-500">Move stock from Storage to the Counter location.</p>
        </Link>
        <Link href="/adjustments" className="rounded-lg border border-slate-200 p-5 hover:border-slate-400 hover:bg-slate-50">
          <h2 className="font-medium text-slate-900">Adjustments</h2>
          <p className="text-sm text-slate-500">Request, investigate, approve, and post stock corrections.</p>
        </Link>
        <Link href="/wholesale" className="rounded-lg border border-slate-200 p-5 hover:border-slate-400 hover:bg-slate-50">
          <h2 className="font-medium text-slate-900">Wholesale Orders</h2>
          <p className="text-sm text-slate-500">Reserve, pick, blind-check, authorize, and release orders.</p>
        </Link>
      </div>
    </main>
  );
}
