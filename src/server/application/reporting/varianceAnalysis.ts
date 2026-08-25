import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

const DEFAULT_WINDOW_DAYS = 30;

export interface VarianceByPersonRow {
  userId: string;
  fullName: string;
  requestCount: number;
  totalValue: string;
}

export interface VarianceByLocationRow {
  warehouseLocationId: string;
  locationLabel: string;
  requestCount: number;
  totalValue: string;
}

export interface VarianceAnalysis {
  windowDays: number;
  byPerson: VarianceByPersonRow[];
  byLocation: VarianceByLocationRow[];
}

/**
 * BPD sec.14.6 "variance-by-person and variance-by-location analysis" —
 * monthly rhythm. Uses POSTED AdjustmentRequest.value (the same frozen
 * value G-21's velocity check sums) as the variance signal: whose
 * corrections, and which locations', account for the most adjustment
 * value in the trailing window.
 */
export async function getVarianceAnalysis(prisma: PrismaClient, params: { actorRole: RoleName; windowDays?: number }): Promise<VarianceAnalysis> {
  await assertPermission(prisma, { role: params.actorRole, action: "reporting.variance-analysis.view" });

  const windowDays = params.windowDays ?? DEFAULT_WINDOW_DAYS;
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const adjustments = await prisma.adjustmentRequest.findMany({
    where: { status: "POSTED", createdAt: { gte: windowStart } },
    select: {
      value: true,
      requestedBy: true,
      warehouseLocationId: true,
      warehouseLocation: { select: { zone: true, code: true } },
    },
  });

  const requesterIds = [...new Set(adjustments.map((a) => a.requestedBy))];
  const requesters = await prisma.user.findMany({ where: { id: { in: requesterIds } }, select: { id: true, fullName: true } });
  const requesterNameById = new Map(requesters.map((u) => [u.id, u.fullName]));

  const byPersonMap = new Map<string, { fullName: string; requestCount: number; totalValue: number }>();
  const byLocationMap = new Map<string, { locationLabel: string; requestCount: number; totalValue: number }>();

  for (const a of adjustments) {
    const value = Number(a.value);

    const person = byPersonMap.get(a.requestedBy) ?? { fullName: requesterNameById.get(a.requestedBy) ?? a.requestedBy.slice(0, 8), requestCount: 0, totalValue: 0 };
    person.requestCount += 1;
    person.totalValue += value;
    byPersonMap.set(a.requestedBy, person);

    const locationLabel = `${a.warehouseLocation.zone} (${a.warehouseLocation.code})`;
    const location = byLocationMap.get(a.warehouseLocationId) ?? { locationLabel, requestCount: 0, totalValue: 0 };
    location.requestCount += 1;
    location.totalValue += value;
    byLocationMap.set(a.warehouseLocationId, location);
  }

  const byPerson = Array.from(byPersonMap.entries())
    .map(([userId, v]) => ({ userId, fullName: v.fullName, requestCount: v.requestCount, totalValue: v.totalValue.toFixed(2) }))
    .sort((a, b) => Number(b.totalValue) - Number(a.totalValue));

  const byLocation = Array.from(byLocationMap.entries())
    .map(([warehouseLocationId, v]) => ({ warehouseLocationId, locationLabel: v.locationLabel, requestCount: v.requestCount, totalValue: v.totalValue.toFixed(2) }))
    .sort((a, b) => Number(b.totalValue) - Number(a.totalValue));

  return { windowDays, byPerson, byLocation };
}
