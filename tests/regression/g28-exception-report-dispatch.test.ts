// G-28 — The daily exception report must reach an Owner/Auditor reliably
// and verifiably — restricted to the right roles, and provably unaltered
// once generated (a content hash, not just a timestamp).
// SYSTEM RULE: dispatchDailyExceptionReport is Owner/Auditor-only (enforced
// via the nested generateDailyExceptionReport call), computes a sha256
// content hash of the report body, and upserts one delivery row per
// (businessDate, channel) — a same-day re-dispatch updates the existing
// row rather than creating a duplicate.
// DETECTION/GAP: only one delivery channel ("ON_DEMAND_PULL") exists —
// the audit finding calls for at least two independent channels so a
// failure of one doesn't silently mean the report never reached anyone;
// confirmed directly against the source, not exercised at runtime (there's
// no second channel to call).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { dispatchDailyExceptionReport } from "../../src/server/application/reporting/deliverExceptionReport";
import { PermissionDeniedError } from "../../src/server/domain/rbac/assertPermission";
import { getUserByRole } from "./helpers/receiving";

const prisma = new PrismaClient();

function uniqueBusinessDate(): Date {
  // Spreads fixture businessDates across ~13 years so
  // @@unique([businessDate, channel]) never collides across repeated suite
  // runs on the same calendar day.
  return new Date(Date.now() - Math.floor(Math.random() * 5000) * 86400000);
}

describe("G-28: daily exception report dispatch", () => {
  it("[rule] a non-Owner/Auditor role is rejected", async () => {
    const branchManager = await getUserByRole(prisma, "branch_manager");
    await expect(
      dispatchDailyExceptionReport(prisma, { actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", businessDate: uniqueBusinessDate() }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("[rule] dispatching the same businessDate twice upserts — one delivery row, not two — with a stable content hash when nothing changed", async () => {
    const owner = await getUserByRole(prisma, "owner");
    const businessDate = uniqueBusinessDate();

    const first = await dispatchDailyExceptionReport(prisma, { actorUserId: owner.id, actorRole: "OWNER", businessDate });
    const second = await dispatchDailyExceptionReport(prisma, { actorUserId: owner.id, actorRole: "OWNER", businessDate });

    expect(second.delivery.id).toBe(first.delivery.id);
    expect(second.delivery.generatedContentHash).toBe(first.delivery.generatedContentHash);

    const rows = await prisma.dailyExceptionReportDelivery.findMany({ where: { businessDate: first.delivery.businessDate, channel: first.delivery.channel } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deliveryStatus).toBe("SENT");
  });

  it("[GAP] only one delivery channel exists — the audit finding calls for at least two independent channels", () => {
    const filePath = fileURLToPath(new URL("../../src/server/application/reporting/deliverExceptionReport.ts", import.meta.url));
    const source = readFileSync(filePath, "utf-8");
    const channelLiterals = new Set([...source.matchAll(/channel:\s*["'`](\w+)["'`]/g)].map((m) => m[1]));
    const constLiterals = new Set([...source.matchAll(/CHANNEL\s*=\s*["'`](\w+)["'`]/g)].map((m) => m[1]));
    const allChannels = new Set([...channelLiterals, ...constLiterals]);
    if (allChannels.size >= 2) {
      throw new Error(`[GAP] G-28 FAILED TO STAY A GAP: ${allChannels.size} delivery channels now referenced in deliverExceptionReport.ts — replace this test with a real multi-channel test.`);
    }
    throw new Error(
      "[GAP] G-28 DETECTION: src/server/application/reporting/deliverExceptionReport.ts hardcodes a single channel " +
        `(${[...allChannels].join(", ") || "none found"}) — a failure of this one delivery path currently means the ` +
        "report never reliably reaches an Owner/Auditor; no second, independent channel exists to fall back on.",
    );
  });
});
