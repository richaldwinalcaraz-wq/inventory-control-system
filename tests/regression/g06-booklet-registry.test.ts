// G-06 — The pre-numbered form booklets themselves have no supply-chain control.
// SYSTEM RULE (BR-015, amended): any document number encoded outside a
// registered ACTIVE booklet range is a hard rejection.
// DETECTION: the literal audit wording wants registry-vs-print-shop-invoice
// reconciled quarterly by the Auditor (inherently an external process, no
// print-shop entity exists in this system). What DOES exist is a related,
// weaker proxy — dailyExceptionReport's unaccountedFormsProxy, surfacing
// gaps in issued sequence numbers within an active booklet. Tested as the
// proxy it actually is, not presented as the literal thing.
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { issueDocumentNumber, DocumentNumberRangeError } from "../../src/server/domain/documents/documentNumber";
import { generateDailyExceptionReport } from "../../src/server/application/reporting/dailyExceptionReport";
import { getIloBranch } from "./helpers/receiving";

const prisma = new PrismaClient();
const bookletIdsToClean: string[] = [];
const docNumberIdsToClean: string[] = [];

describe("G-06: booklet registry", () => {
  it("[rule] issuing a document number for a type with no registered booklet is a hard rejection", async () => {
    const branch = await getIloBranch(prisma);
    const documentType = `G06-UNREGISTERED-${Date.now()}`;

    await expect(
      prisma.$transaction((tx) => issueDocumentNumber(tx, { branchId: branch.id, branchCode: branch.code, documentType, referenceId: "test" })),
    ).rejects.toThrow(DocumentNumberRangeError);
  });

  it("[rule] issuing succeeds once a booklet range is registered, and the number is exactly the booklet's rangeStart", async () => {
    const branch = await getIloBranch(prisma);
    const documentType = `G06-REGISTERED-${Date.now()}`;
    const owner = await prisma.user.findUniqueOrThrow({ where: { username: "owner" } });
    const booklet = await prisma.documentBookletRegistry.create({
      data: { branchId: branch.id, documentType, rangeStart: 1, rangeEnd: 10, registeredBy: owner.id, status: "ACTIVE" },
    });
    bookletIdsToClean.push(booklet.id);

    const issued = await prisma.$transaction((tx) => issueDocumentNumber(tx, { branchId: branch.id, branchCode: branch.code, documentType, referenceId: "test" }));
    docNumberIdsToClean.push(issued.id);
    expect(issued.sequenceNo).toBe(1);
  });

  it("[rule] issuing beyond a booklet's registered range is rejected, not silently allowed", async () => {
    const branch = await getIloBranch(prisma);
    const documentType = `G06-EXHAUSTED-${Date.now()}`;
    const owner = await prisma.user.findUniqueOrThrow({ where: { username: "owner" } });
    const booklet = await prisma.documentBookletRegistry.create({
      data: { branchId: branch.id, documentType, rangeStart: 1, rangeEnd: 1, registeredBy: owner.id, status: "ACTIVE" }, // exactly one number available
    });
    bookletIdsToClean.push(booklet.id);

    const first = await prisma.$transaction((tx) => issueDocumentNumber(tx, { branchId: branch.id, branchCode: branch.code, documentType, referenceId: "test-1" }));
    docNumberIdsToClean.push(first.id);

    await expect(
      prisma.$transaction((tx) => issueDocumentNumber(tx, { branchId: branch.id, branchCode: branch.code, documentType, referenceId: "test-2" })),
    ).rejects.toThrow(DocumentNumberRangeError);
  });

  it("[proxy detect] unaccountedFormsProxy surfaces a gap in issued sequence numbers within an active booklet", async () => {
    const branch = await getIloBranch(prisma);
    const documentType = `G06-GAP-${Date.now()}`;
    const owner = await prisma.user.findUniqueOrThrow({ where: { username: "owner" } });
    const booklet = await prisma.documentBookletRegistry.create({
      data: { branchId: branch.id, documentType, rangeStart: 1, rangeEnd: 3, registeredBy: owner.id, status: "ACTIVE" },
    });
    bookletIdsToClean.push(booklet.id);

    // Directly seed the "already issued" precondition state (sequence 1 and
    // 3 issued, 2 deliberately skipped) — the function under test here is
    // the detector, not the issuer, so this mirrors how earlier verify
    // scripts set up antecedent DB state directly.
    const year = new Date().getFullYear();
    const doc1 = await prisma.documentNumber.create({ data: { branchId: branch.id, documentType, year, sequenceNo: 1, fullNumber: `${documentType}-${branch.code}-${year}-000001` } });
    const doc3 = await prisma.documentNumber.create({ data: { branchId: branch.id, documentType, year, sequenceNo: 3, fullNumber: `${documentType}-${branch.code}-${year}-000003` } });
    docNumberIdsToClean.push(doc1.id, doc3.id);

    const report = await generateDailyExceptionReport(prisma, { actorRole: "OWNER", businessDate: new Date() });
    const gapRow = report.unaccountedFormsProxy.find((r) => r.documentType === documentType);
    expect(gapRow).toBeDefined();
    expect(gapRow?.missingSequenceNos).toEqual([2]);
  });
});

afterAll(async () => {
  await prisma.documentNumber.deleteMany({ where: { id: { in: docNumberIdsToClean } } });
  await prisma.documentBookletRegistry.deleteMany({ where: { id: { in: bookletIdsToClean } } });
  await prisma.$disconnect();
});
