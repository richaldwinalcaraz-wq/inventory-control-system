// G-34 — Document-number uniqueness is only checked by the interface, not
// guaranteed by the database itself.
// SYSTEM RULE: uniqueness on (branchId, documentType, year, sequenceNo) is
// a hard database constraint — not just an application-level check that a
// future/alternate code path could bypass.
// DETECTION: same gap as G-33 — rejections aren't logged anywhere reviewable.
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { getIloBranch } from "./helpers/receiving";

const prisma = new PrismaClient();
const createdIds: string[] = [];

describe("G-34: document number DB-level uniqueness", () => {
  it("[rule] a duplicate (branch, documentType, year, sequenceNo) is rejected at the DATABASE layer, bypassing the application entirely", async () => {
    const branch = await getIloBranch(prisma);
    const documentType = `G34-DIRECT-${Date.now()}`;
    const year = new Date().getFullYear();

    // Deliberately bypasses issueDocumentNumber's own application-level
    // sequencing/booklet logic entirely — this is the exact "a future API"
    // scenario BR-015's own wording calls out; the guarantee must hold even
    // when no application code is involved at all.
    const first = await prisma.documentNumber.create({
      data: { branchId: branch.id, documentType, year, sequenceNo: 1, fullNumber: `${documentType}-${branch.code}-${year}-000001` },
    });
    createdIds.push(first.id);

    await expect(
      prisma.documentNumber.create({
        data: { branchId: branch.id, documentType, year, sequenceNo: 1, fullNumber: `${documentType}-${branch.code}-${year}-000001-DUP` },
      }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it("[rule] the fullNumber column also has its own independent uniqueness guarantee", async () => {
    const branch = await getIloBranch(prisma);
    const documentType = `G34-FULLNUM-${Date.now()}`;
    const year = new Date().getFullYear();
    const fullNumber = `${documentType}-${branch.code}-${year}-000001`;

    const first = await prisma.documentNumber.create({ data: { branchId: branch.id, documentType, year, sequenceNo: 1, fullNumber } });
    createdIds.push(first.id);

    await expect(
      prisma.documentNumber.create({ data: { branchId: branch.id, documentType, year, sequenceNo: 2, fullNumber } }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it("[GAP] DETECTION: rejected duplicate document-number attempts aren't logged anywhere reviewable", () => {
    throw new Error(
      "[GAP] G-34 DETECTION: a database-level unique-constraint violation on document_number surfaces only as a " +
        "raw Prisma/Postgres error to whichever caller triggered it — nothing writes it to AuditLog or any report, " +
        "so a pattern of duplicate-number attempts (a real tamper/bug signal) is invisible to the Auditor.",
    );
  });
});

afterAll(async () => {
  await prisma.documentNumber.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.$disconnect();
});
