import { createHash } from "node:crypto";
import type { PrismaClient, RoleName } from "@prisma/client";
import { generateDailyExceptionReport } from "./dailyExceptionReport";
import { startOfDayManila } from "../../domain/time/businessDate";

export interface DispatchDailyExceptionReportParams {
  actorUserId: string;
  actorRole: RoleName;
  businessDate: Date;
}

const CHANNEL = "ON_DEMAND_PULL";

/**
 * Channel 1 of G-28, shipping unconditionally per the Phase 4 plan's
 * decision #1 — an authenticated Owner/Auditor pull, recorded so a future
 * push channel (EMAIL/SMS) can cross-verify its own content against this
 * one via generatedContentHash. Upserts on (businessDate, channel): viewing
 * the same day's report twice updates the delivery record rather than
 * duplicating it.
 */
export async function dispatchDailyExceptionReport(prisma: PrismaClient, params: DispatchDailyExceptionReportParams) {
  const report = await generateDailyExceptionReport(prisma, { actorRole: params.actorRole, businessDate: params.businessDate });

  const generatedContentHash = createHash("sha256").update(JSON.stringify(report, (_key, value) => (typeof value === "bigint" ? value.toString() : value))).digest("hex");

  const businessDateOnly = startOfDayManila(params.businessDate);

  const delivery = await prisma.dailyExceptionReportDelivery.upsert({
    where: { businessDate_channel: { businessDate: businessDateOnly, channel: CHANNEL } },
    create: {
      businessDate: businessDateOnly,
      channel: CHANNEL,
      dispatchedAt: new Date(),
      deliveryStatus: "SENT",
      generatedContentHash,
      triggeredBy: params.actorUserId,
    },
    update: {
      dispatchedAt: new Date(),
      deliveryStatus: "SENT",
      generatedContentHash,
      triggeredBy: params.actorUserId,
    },
  });

  return { report, delivery };
}
