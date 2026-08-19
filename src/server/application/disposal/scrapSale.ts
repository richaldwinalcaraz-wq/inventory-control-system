import { createHash } from "node:crypto";
import type { PrismaClient, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { resolveRequiredApprover } from "../../domain/approval/resolveRequiredApprover";
import { issueDocumentNumber } from "../../domain/documents/documentNumber";
import { postLedgerEntryInTx } from "../../domain/ledger/postLedgerEntry";
import { markDamageReportDisposedIfComplete } from "../../domain/disposal/finalize";
import { DisposalCertificateNotFoundError, InvalidDisposalCertificateStateError, WrongDispositionError, NotReadyForDisposalPostingError } from "./destroy";

export class ScrapSaleAlreadyRecordedError extends Error {}
export class ScrapSaleJustificationRequiredError extends Error {}
export class ScrapBuyerBenchmarkNotFoundError extends Error {}
export class ScrapSaleRecordNotFoundError extends Error {}
export class ScrapSaleNotBelowBenchmarkError extends Error {}
export class ScrapSaleAlreadyApprovedError extends Error {}
export class WrongScrapSaleApproverRoleError extends Error {}
export class ScrapSaleApprovalRequiredError extends Error {}
export class QuoteEvidenceRequiredError extends Error {}

export interface RecordScrapSaleQuoteParams {
  actorUserId: string;
  actorRole: RoleName;
  dcId: string;
  buyerId?: string;
  buyerName: string;
  pricePerKg: number;
  weightKg: number;
  quotesOnFile?: Array<{ buyerName: string; pricePerKg: number }>;
  quoteEvidencePhotos?: Array<{ storageKey: string; captureMethod: "LIVE_CAMERA_STREAM" | "OTHER" }>;
  scrapBuyerBenchmarkId?: string;
}

/**
 * DC-3 step 1. Requires one of BPD's two satisfying paths: two comparative
 * quotes on file, or a match against the ScrapBuyerBenchmark master list.
 * The quotes-on-file path additionally requires a live-captured photo of
 * the quote document(s) — closes a real loophole a close-out audit found:
 * without it, a caller could type in two fabricated quotes and skip the
 * benchmark comparison (the workflow's one financial control) with zero
 * corroboration. Same hard-block discipline as DESTROY's evidence gate,
 * re-checked again at posting (see postScrapSaleCertificate), never just
 * trusted from this step alone. ScrapSaleRecord.disposalCertificateId is
 * @unique, so a second call for the same certificate fails on the DB
 * constraint — no extra lock needed to close that race (mirrors the plan's
 * own reasoning for this model).
 */
export async function recordScrapSaleQuote(prisma: PrismaClient, params: RecordScrapSaleQuoteParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "disposal.certificate.scrap-sale.create" });

  const hasQuotes = (params.quotesOnFile?.length ?? 0) >= 2;
  if (!hasQuotes && !params.scrapBuyerBenchmarkId) {
    throw new ScrapSaleJustificationRequiredError("Either two comparative quotes on file or a matched scrap-buyer benchmark is required.");
  }
  if (hasQuotes && !params.scrapBuyerBenchmarkId) {
    const hasLivePhoto = (params.quoteEvidencePhotos ?? []).some((p) => p.captureMethod === "LIVE_CAMERA_STREAM");
    if (!hasLivePhoto) {
      throw new QuoteEvidenceRequiredError("A live-captured photo of the quote document(s) is required when using the two-quotes-on-file path.");
    }
  }

  return prisma.$transaction(async (tx) => {
    const cert = await tx.disposalCertificate.findUnique({ where: { id: params.dcId } });
    if (!cert) throw new DisposalCertificateNotFoundError(params.dcId);
    if (cert.disposition !== "SCRAP_SALE") throw new WrongDispositionError(`Certificate ${cert.id} is ${cert.disposition}, not SCRAP_SALE.`);
    if (cert.status !== "DRAFT") throw new InvalidDisposalCertificateStateError(`Cannot record a scrap sale for a certificate that is ${cert.status} — it must be DRAFT.`);

    const existing = await tx.scrapSaleRecord.findUnique({ where: { disposalCertificateId: cert.id } });
    if (existing) throw new ScrapSaleAlreadyRecordedError(`Certificate ${cert.id} already has a scrap sale record.`);

    let belowBenchmark = false;
    if (params.scrapBuyerBenchmarkId) {
      const benchmark = await tx.scrapBuyerBenchmark.findUnique({ where: { id: params.scrapBuyerBenchmarkId } });
      if (!benchmark) throw new ScrapBuyerBenchmarkNotFoundError(params.scrapBuyerBenchmarkId);
      belowBenchmark = params.pricePerKg < Number(benchmark.benchmarkRatePerKg);
    }

    const record = await tx.scrapSaleRecord.create({
      data: {
        disposalCertificateId: cert.id,
        buyerId: params.buyerId,
        buyerName: params.buyerName,
        pricePerKg: params.pricePerKg,
        weightKg: params.weightKg,
        totalValue: params.pricePerKg * params.weightKg,
        quotesOnFile: params.quotesOnFile,
        scrapBuyerBenchmarkId: params.scrapBuyerBenchmarkId,
        belowBenchmark,
      },
    });

    if (params.quoteEvidencePhotos?.length) {
      for (const photo of params.quoteEvidencePhotos) {
        await tx.transactionEvidence.create({
          data: {
            referenceType: "ScrapSaleRecord",
            referenceId: record.id,
            storageKey: photo.storageKey,
            captureMethod: photo.captureMethod,
            capturedBy: params.actorUserId,
          },
        });
      }
    }

    return record;
  });
}

export interface ApproveScrapSaleBelowBenchmarkParams {
  actorUserId: string;
  actorRole: RoleName;
  dcId: string;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
}

/** DC-3 step 2 (only reachable when belowBenchmark) — gated by SCRAP_SALE_BELOW_BENCHMARK, never a hardcoded role. */
export async function approveScrapSaleBelowBenchmark(prisma: PrismaClient, params: ApproveScrapSaleBelowBenchmarkParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "disposal.certificate.scrap-sale.create" });

  return prisma.$transaction(async (tx) => {
    const cert = await tx.disposalCertificate.findUnique({ where: { id: params.dcId }, include: { damageReport: true } });
    if (!cert) throw new DisposalCertificateNotFoundError(params.dcId);

    const record = await tx.scrapSaleRecord.findUnique({ where: { disposalCertificateId: cert.id } });
    if (!record) throw new ScrapSaleRecordNotFoundError(`Certificate ${cert.id} has no scrap sale record yet.`);
    if (!record.belowBenchmark) throw new ScrapSaleNotBelowBenchmarkError("This scrap sale is not below benchmark — no Owner approval is required.");
    if (record.ownerApprovedBy) throw new ScrapSaleAlreadyApprovedError("This scrap sale is already approved.");

    const threshold = await resolveRequiredApprover(tx, { branchId: cert.damageReport.branchId, transactionType: "SCRAP_SALE_BELOW_BENCHMARK", value: Number(record.totalValue) });
    if (params.actorRole !== threshold.requiredApproverRole) {
      throw new WrongScrapSaleApproverRoleError(`This below-benchmark scrap sale requires ${threshold.requiredApproverRole} approval.`);
    }

    await requirePostingAuthorization(tx, { session: params.session, pinTokenId: params.pinTokenId, action: `disposal.scrap-sale.approve:${cert.id}` });

    return tx.scrapSaleRecord.update({ where: { id: record.id }, data: { ownerApprovedBy: params.actorUserId } });
  });
}

export interface PostScrapSaleCertificateParams {
  actorUserId: string;
  actorRole: RoleName;
  branchCode: string;
  dcId: string;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
}

/** DC-3 step 3. Posts DAMAGE_OUT at the certificate's frozen valueAtCost — the scrap sale's own proceeds live on ScrapSaleRecord, separate from inventory cost basis. */
export async function postScrapSaleCertificate(prisma: PrismaClient, params: PostScrapSaleCertificateParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "disposal.certificate.scrap-sale.create" });

  return prisma.$transaction(async (tx) => {
    const cert = await tx.disposalCertificate.findUnique({ where: { id: params.dcId }, include: { damageReport: true } });
    if (!cert) throw new DisposalCertificateNotFoundError(params.dcId);
    if (cert.disposition !== "SCRAP_SALE") throw new WrongDispositionError(`Certificate ${cert.id} is ${cert.disposition}, not SCRAP_SALE.`);
    if (cert.status !== "DRAFT") throw new InvalidDisposalCertificateStateError(`Cannot post a certificate that is ${cert.status} — it must be DRAFT.`);

    const record = await tx.scrapSaleRecord.findUnique({ where: { disposalCertificateId: cert.id } });
    if (!record) throw new ScrapSaleRecordNotFoundError(`Certificate ${cert.id} has no scrap sale record yet.`);
    if (record.belowBenchmark && !record.ownerApprovedBy) {
      throw new ScrapSaleApprovalRequiredError("This below-benchmark scrap sale requires Owner approval before it can be posted.");
    }
    if (!record.scrapBuyerBenchmarkId) {
      const evidence = await tx.transactionEvidence.findMany({ where: { referenceType: "ScrapSaleRecord", referenceId: record.id } });
      if (!evidence.some((e) => e.captureMethod === "LIVE_CAMERA_STREAM")) {
        throw new QuoteEvidenceRequiredError("A quotes-on-file scrap sale cannot be posted without an attached live-captured quote document photo.");
      }
    }

    const claim = await tx.disposalCertificate.updateMany({ where: { id: cert.id, status: "DRAFT" }, data: { status: "POSTED" } });
    if (claim.count === 0) {
      throw new NotReadyForDisposalPostingError(`Certificate ${cert.id} is no longer DRAFT — likely claimed by a concurrent post attempt.`);
    }

    await requirePostingAuthorization(tx, { session: params.session, pinTokenId: params.pinTokenId, action: `disposal.certificate.post:${cert.id}` });

    const docNumber = await issueDocumentNumber(tx, {
      branchId: cert.damageReport.branchId,
      branchCode: params.branchCode,
      documentType: "DC",
      referenceId: cert.id,
    });

    const unitCost = Number(cert.valueAtCost) / Number(cert.quantity);
    const requestPayload = { dcId: cert.id, qty: cert.quantity.toString() };
    const ledgerResult = await postLedgerEntryInTx(tx, {
      idempotency: {
        documentType: "DC",
        documentNumber: docNumber.fullNumber,
        branchCode: params.branchCode,
        requestPayloadHash: createHash("sha256").update(JSON.stringify(requestPayload)).digest("hex"),
      },
      branchId: cert.damageReport.branchId,
      productVariantId: cert.damageReport.productVariantId,
      warehouseLocationId: cert.damageReport.warehouseLocationId,
      quantityDeltaBase: -Number(cert.quantity),
      movementType: "DAMAGE_OUT",
      unitCostAtMovement: unitCost,
      referenceType: "DisposalCertificate",
      referenceId: cert.id,
      documentNumber: docNumber.fullNumber,
      reasonCode: "SCRAP_SALE",
      performedBy: params.actorUserId,
    });

    const posted = await tx.disposalCertificate.update({ where: { id: cert.id }, data: { documentNumberId: docNumber.id } });
    await markDamageReportDisposedIfComplete(tx, cert.damageReportId);

    return { disposalCertificate: posted, documentNumber: docNumber.fullNumber, ledger: ledgerResult.ledger };
  });
}
