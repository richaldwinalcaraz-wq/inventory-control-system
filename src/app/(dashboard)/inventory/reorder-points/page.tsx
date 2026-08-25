import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { listReorderPoints } from "@/server/application/inventory/reorderPoints";
import { PermissionDeniedError } from "@/server/domain/rbac/assertPermission";
import { ReorderPointsTable } from "./ReorderPointsTable";

export default async function ReorderPointsPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  let rows;
  try {
    rows = await listReorderPoints(prisma, { actorRole: session.user.role });
  } catch (err) {
    if (err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Reorder Points"
        description="Set the quantity that triggers a low-stock alert for each product. Leave blank to stop monitoring a product."
      />

      <Card className="overflow-x-auto">
        <ReorderPointsTable rows={rows} />
      </Card>
    </div>
  );
}
