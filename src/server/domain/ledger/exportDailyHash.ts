import type { PrismaClient } from "@prisma/client";
import { verifyChain } from "./verifyChain";

/** Refuses to publish a terminal hash over a chain that doesn't currently verify. */
export class ChainIntegrityError extends Error {}

/**
 * Creates the day's terminal-hash export record — refuses outright if the
 * chain doesn't verify first, since an export is a claim "this is the
 * legitimate state as of today," and publishing one over a broken chain
 * would defeat its own purpose.
 *
 * Real delivery to the Owner/Auditor via a channel neither the System
 * Administrator nor branch staff control (the plan's actual design goal
 * for this job) is NOT wired up in Phase 1 dev — no SMTP credentials are
 * configured locally, since Docker/Mailpit was deferred along with Redis
 * this session. This function creates the durable, queryable record;
 * wiring the daily BullMQ schedule and real email delivery is deployment
 * configuration, not a remaining code gap. Call this on-demand (e.g. from
 * an Auditor-facing route) until that scheduling exists.
 */
export async function exportDailyHash(prisma: PrismaClient, businessDate: Date) {
  const result = await verifyChain(prisma);
  if (!result.valid) {
    throw new ChainIntegrityError(
      `Refusing to export a terminal hash — the chain is broken at sequenceNo=${result.brokenAtSequenceNo}.`,
    );
  }

  const dateOnly = new Date(
    Date.UTC(businessDate.getUTCFullYear(), businessDate.getUTCMonth(), businessDate.getUTCDate()),
  );
  const latest = await prisma.stockLedger.findFirst({ orderBy: { sequenceNo: "desc" } });

  return prisma.ledgerHashExport.upsert({
    where: { businessDate: dateOnly },
    update: {
      lastSequenceNo: latest?.sequenceNo ?? 0n,
      terminalHash: result.terminalHash!,
      recipients: "owner,auditor (delivery not wired in Phase 1 dev)",
    },
    create: {
      businessDate: dateOnly,
      lastSequenceNo: latest?.sequenceNo ?? 0n,
      terminalHash: result.terminalHash!,
      recipients: "owner,auditor (delivery not wired in Phase 1 dev)",
    },
  });
}
