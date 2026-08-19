import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { GateLogForm } from "./GateLogForm";

export default async function GateLogEntryPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">Gate Log — Step 1</h1>
      <GateLogForm />
    </div>
  );
}
