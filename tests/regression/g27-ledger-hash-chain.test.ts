// G-27 — The digital ledger has no tamper-evidence against a privileged
// actor bypassing the application layer entirely.
// SYSTEM RULE: every StockLedger row is hash-chained (prevHash/rowHash);
// verifyChain recomputes the entire chain and detects any row that doesn't
// match what its own fields canonically hash to.
// GAP (confirmed by grep against src/app/api): verifyChain/exportDailyHash
// have zero HTTP route exposing them — they're correct, but only reachable
// by direct import, not through the running application.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { postLedgerEntry } from "../../src/server/domain/ledger/postLedgerEntry";
import { verifyChain } from "../../src/server/domain/ledger/verifyChain";
import { exportDailyHash, ChainIntegrityError } from "../../src/server/domain/ledger/exportDailyHash";
import { getIloBranch, getSeedVariant, getUserByRole } from "./helpers/receiving";

const prisma = new PrismaClient();

function walkApiDir(dir: string): string[] {
  const entries = readdirSync(dir);
  let files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files = files.concat(walkApiDir(full));
    else if (entry.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("G-27: ledger hash chain", () => {
  it("[rule] a freshly-posted chain verifies clean", async () => {
    const result = await verifyChain(prisma);
    expect(result.valid).toBe(true);
  });

  it("[rule] directly corrupting a ledger row's stored hash (simulating a privileged out-of-band DB edit) is detected, at the exact sequenceNo", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const owner = await getUserByRole(prisma, "owner");
    const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: branch.id } } });

    const posted = await postLedgerEntry(prisma, {
      idempotency: { documentType: "G27TEST", documentNumber: `G27-${Date.now()}`, branchCode: branch.code, requestPayloadHash: `hash-${Date.now()}` },
      branchId: branch.id,
      productVariantId: variant.id,
      warehouseLocationId: location.id,
      quantityDeltaBase: 1,
      movementType: "ADJUSTMENT_IN",
      unitCostAtMovement: 1,
      referenceType: "RegressionTestG27",
      referenceId: `g27-${Date.now()}`,
      documentNumber: `G27-DOC-${Date.now()}`,
      performedBy: owner.id,
    });

    const original = await prisma.stockLedger.findUniqueOrThrow({ where: { id: posted.ledger.id }, select: { rowHash: true } });

    try {
      // Bypasses the app layer entirely — exactly the attack G-27 exists to catch.
      await prisma.$executeRaw`UPDATE stock_ledger SET row_hash = 'tampered0000000000000000000000000000000000000000000000000000' WHERE id = ${posted.ledger.id}`;

      const result = await verifyChain(prisma);
      expect(result.valid).toBe(false);
      expect(result.brokenAtSequenceNo).toBe(posted.ledger.sequenceNo);
    } finally {
      // Restore — this row is permanent/hash-chained (see cleanupReceivingReports'
      // own comment); corrupting it further downstream would break every
      // later test file's chain, so the fix must be an exact revert, not a delete.
      await prisma.$executeRaw`UPDATE stock_ledger SET row_hash = ${original.rowHash} WHERE id = ${posted.ledger.id}`;
      const restored = await verifyChain(prisma);
      expect(restored.valid).toBe(true);
    }
  });

  it("[rule] exportDailyHash refuses to publish over a broken chain", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const owner = await getUserByRole(prisma, "owner");
    const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: branch.id } } });

    const posted = await postLedgerEntry(prisma, {
      idempotency: { documentType: "G27TEST", documentNumber: `G27-EXPORT-${Date.now()}`, branchCode: branch.code, requestPayloadHash: `hash-${Date.now()}` },
      branchId: branch.id,
      productVariantId: variant.id,
      warehouseLocationId: location.id,
      quantityDeltaBase: 1,
      movementType: "ADJUSTMENT_IN",
      unitCostAtMovement: 1,
      referenceType: "RegressionTestG27",
      referenceId: `g27-export-${Date.now()}`,
      documentNumber: `G27-EXPORT-DOC-${Date.now()}`,
      performedBy: owner.id,
    });
    const original = await prisma.stockLedger.findUniqueOrThrow({ where: { id: posted.ledger.id }, select: { rowHash: true } });

    try {
      await prisma.$executeRaw`UPDATE stock_ledger SET row_hash = 'tampered0000000000000000000000000000000000000000000000000000' WHERE id = ${posted.ledger.id}`;
      await expect(exportDailyHash(prisma, new Date())).rejects.toThrow(ChainIntegrityError);
    } finally {
      await prisma.$executeRaw`UPDATE stock_ledger SET row_hash = ${original.rowHash} WHERE id = ${posted.ledger.id}`;
    }
  });

  it("[GAP] neither verifyChain nor exportDailyHash is reachable through any HTTP route", () => {
    const apiDir = fileURLToPath(new URL("../../src/app/api", import.meta.url));
    const files = walkApiDir(apiDir);
    const hits = files.filter((f) => {
      const content = readFileSync(f, "utf-8");
      return content.includes("verifyChain") || content.includes("exportDailyHash");
    });
    if (hits.length === 0) {
      throw new Error(
        "[GAP] G-27: scanned every .ts file under src/app/api — zero routes import verifyChain or exportDailyHash. " +
          "Both functions are correct and directly testable, but an Owner/Auditor cannot trigger chain verification " +
          "or the daily hash export through the running application at all; real delivery 'outside branch control' " +
          "(the plan's own stated goal) is not wired up.",
      );
    }
  });
});
