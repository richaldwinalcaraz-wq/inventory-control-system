// G-22 — A negative-stock override can become a rubber-stamped after-the-
// fact approval instead of a real-time check.
// SYSTEM RULE (BR-006): a movement that would take stock_balance negative
// is hard-blocked; a real-time Owner-approved override path exists in the
// domain layer.
// GAP (confirmed by grep): the "no retroactive path" half is satisfied —
// it's an unconditional hard block — but allowNegativeStockOverride is
// never actually passed by ANY application/route caller in this codebase,
// so the real-time override path itself is unreachable through the app.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { postLedgerEntry, NegativeStockError } from "../../src/server/domain/ledger/postLedgerEntry";
import { getIloBranch, getSeedVariant, getUserByRole } from "./helpers/receiving";

const prisma = new PrismaClient();

function walkDir(dir: string): string[] {
  let files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files = files.concat(walkDir(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) files.push(full);
  }
  return files;
}

describe("G-22: negative stock hard block", () => {
  it("[rule] a movement that would take stock negative is blocked outright, with no override supplied", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const owner = await getUserByRole(prisma, "owner");
    const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: branch.id } } });

    // This exact (variant, location) triple starts at whatever balance
    // prior tests left it at — requesting an absurdly large negative delta
    // guarantees insufficiency regardless of accumulated residuals.
    await expect(
      postLedgerEntry(prisma, {
        idempotency: { documentType: "G22TEST", documentNumber: `G22-${Date.now()}`, branchCode: branch.code, requestPayloadHash: `hash-${Date.now()}` },
        branchId: branch.id,
        productVariantId: variant.id,
        warehouseLocationId: location.id,
        quantityDeltaBase: -999999999,
        movementType: "ADJUSTMENT_OUT",
        unitCostAtMovement: 1,
        referenceType: "RegressionTestG22",
        referenceId: `g22-${Date.now()}`,
        documentNumber: `G22-DOC-${Date.now()}`,
        performedBy: owner.id,
      }),
    ).rejects.toThrow(NegativeStockError);
  });

  it("[rule] a blocked attempt writes an AuditLog row surviving the rollback", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const owner = await getUserByRole(prisma, "owner");
    const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: branch.id } } });
    const referenceId = `g22-audit-${Date.now()}`;

    await postLedgerEntry(prisma, {
      idempotency: { documentType: "G22TEST", documentNumber: `G22-AUDIT-${Date.now()}`, branchCode: branch.code, requestPayloadHash: `hash-${Date.now()}` },
      branchId: branch.id,
      productVariantId: variant.id,
      warehouseLocationId: location.id,
      quantityDeltaBase: -999999999,
      movementType: "ADJUSTMENT_OUT",
      unitCostAtMovement: 1,
      referenceType: "RegressionTestG22",
      referenceId,
      documentNumber: `G22-AUDIT-DOC-${Date.now()}`,
      performedBy: owner.id,
    }).catch(() => {});

    const auditRow = await prisma.auditLog.findFirst({ where: { action: "ledger.negative_stock_blocked", entityType: "StockBalance" }, orderBy: { createdAt: "desc" } });
    expect(auditRow).not.toBeNull();
  });

  it("[GAP] allowNegativeStockOverride is never passed by any application or route code — the real-time Owner override path is unreachable", () => {
    const srcDir = fileURLToPath(new URL("../../src/server", import.meta.url));
    const files = walkDir(srcDir).filter((f) => !f.endsWith("postLedgerEntry.ts")); // exclude the definition site itself
    const hits = files.filter((f) => readFileSync(f, "utf-8").includes("allowNegativeStockOverride"));
    if (hits.length === 0) {
      throw new Error(
        "[GAP] G-22: grepped every .ts file under src/server (excluding postLedgerEntry.ts's own definition) — " +
          "zero callers pass allowNegativeStockOverride. The domain-layer override mechanism is correct, but no " +
          "application function or HTTP route wires an Owner-approved real-time override to it — negative stock " +
          "is currently an unconditional hard block with no exercisable escape hatch at all.",
      );
    }
  });
});
