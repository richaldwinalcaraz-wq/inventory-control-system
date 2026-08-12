import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

/**
 * Thrown when the next sequence number for a (branch, documentType, year)
 * falls outside every registered ACTIVE booklet range. Callers must
 * hard-reject the request — never fall back to issuing an unregistered
 * number (G-34).
 */
export class DocumentNumberRangeError extends Error {}

export interface IssueDocumentNumberParams {
  branchId: string;
  branchCode: string; // e.g. "ILO" — used in the human-readable fullNumber
  documentType: string; // e.g. "RR"
  referenceId?: string;
}

export interface IssuedDocumentNumber {
  id: string;
  fullNumber: string;
  sequenceNo: number;
}

/**
 * Atomically issues the next document number for a branch+type+year,
 * validated against the registered booklet ranges (G-06) and enforced
 * uniquely at the DB layer (G-34). Must be called inside the same
 * transaction as the document it numbers, so a failed posting never
 * leaves a gap.
 *
 * Race-safety: the sequence row is locked with SELECT ... FOR UPDATE
 * before the candidate number is validated and consumed, so two
 * concurrent callers for the same branch+type+year serialize rather than
 * issuing the same number twice.
 */
export async function issueDocumentNumber(
  tx: Prisma.TransactionClient,
  params: IssueDocumentNumberParams,
): Promise<IssuedDocumentNumber> {
  const year = new Date().getFullYear();

  // Ensure the sequence row exists before we try to lock it — safe under
  // concurrent first-issuance because of the ON CONFLICT DO NOTHING.
  await tx.$executeRaw`
    INSERT INTO document_sequence (id, branch_id, document_type, year, current_value)
    VALUES (${randomUUID()}, ${params.branchId}, ${params.documentType}, ${year}, 0)
    ON CONFLICT (branch_id, document_type, year) DO NOTHING
  `;

  const rows = await tx.$queryRaw<{ current_value: number }[]>`
    SELECT current_value FROM document_sequence
    WHERE branch_id = ${params.branchId} AND document_type = ${params.documentType} AND year = ${year}
    FOR UPDATE
  `;
  const sequenceRow = rows[0];
  if (!sequenceRow) {
    throw new DocumentNumberRangeError(
      `document_sequence row for branch=${params.branchId} type=${params.documentType} year=${year} was not found after insert — this should be unreachable.`,
    );
  }
  const candidateSeq = sequenceRow.current_value + 1;

  const booklet = await tx.documentBookletRegistry.findFirst({
    where: {
      branchId: params.branchId,
      documentType: params.documentType,
      status: "ACTIVE",
      rangeStart: { lte: candidateSeq },
      rangeEnd: { gte: candidateSeq },
    },
  });
  if (!booklet) {
    throw new DocumentNumberRangeError(
      `No active booklet range covers ${params.documentType} sequence ${candidateSeq} for branch ${params.branchId} — register a new booklet before continuing.`,
    );
  }

  await tx.documentSequence.update({
    where: {
      branchId_documentType_year: {
        branchId: params.branchId,
        documentType: params.documentType,
        year,
      },
    },
    data: { currentValue: candidateSeq },
  });

  const fullNumber = `${params.documentType}-${params.branchCode}-${year}-${String(candidateSeq).padStart(6, "0")}`;

  const doc = await tx.documentNumber.create({
    data: {
      branchId: params.branchId,
      documentType: params.documentType,
      year,
      sequenceNo: candidateSeq,
      fullNumber,
      referenceId: params.referenceId,
    },
  });

  return { id: doc.id, fullNumber: doc.fullNumber, sequenceNo: candidateSeq };
}
