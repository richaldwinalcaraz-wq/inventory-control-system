import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await getAppSession();
  if (!session) redirect("/login");

  const branch = session.user.branchId
    ? await prisma.branch.findUnique({
        where: { id: session.user.branchId },
        select: { name: true },
      })
    : null;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          userName={session.user.name ?? "Unknown User"}
          role={session.user.role}
          branchLabel={branch?.name ?? "All Branches"}
        />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
