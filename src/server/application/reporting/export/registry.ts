import type { PrismaClient, RoleName } from "@prisma/client";
import type { ExportTable } from "./types";
import { getShrinkageRateKpi } from "../shrinkageRate";
import { getCycleCountComplianceKpi } from "../cycleCountCompliance";
import { getConsolidatedBranchStockView } from "../consolidatedBranchView";
import { getQuarantineDisposalAgingReport } from "../quarantineDisposalAging";
import { getDamageVsShrinkageReport } from "../damageVsShrinkage";
import { generateDailyExceptionReport } from "../dailyExceptionReport";
import { getLowStockAlerts } from "../lowStockAlerts";
import { getDailyStockMovementSummary } from "../dailyStockMovement";
import { getVarianceAnalysis } from "../varianceAnalysis";
import { getTrendReview } from "../trendReview";

export class UnknownReportIdError extends Error {}
export class UnsupportedExportFormatError extends Error {}

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

function bigintSafeJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
}

async function buildShrinkageRateTable(prisma: PrismaClient, actorRole: RoleName): Promise<ExportTable> {
  const rows = await getShrinkageRateKpi(prisma, { actorRole });
  return {
    title: "Shrinkage Rate KPI",
    columns: [
      { key: "branchCode", header: "Branch" },
      { key: "windowDays", header: "Window (days)" },
      { key: "shrinkageValue", header: "Shrinkage Value (PHP)" },
      { key: "cogs", header: "COGS (PHP)" },
      { key: "shrinkageRatePercent", header: "Shrinkage Rate (%)" },
    ],
    rows: rows.map((r) => ({ branchCode: r.branchCode, windowDays: r.windowDays, shrinkageValue: r.shrinkageValue, cogs: r.cogs, shrinkageRatePercent: r.shrinkageRatePercent ?? "N/A" })),
  };
}

async function buildCycleCountComplianceTable(prisma: PrismaClient, actorRole: RoleName): Promise<ExportTable> {
  const rows = await getCycleCountComplianceKpi(prisma, { actorRole });
  const flat: Array<Record<string, string | number>> = [];
  for (const r of rows) {
    flat.push({ branchCode: r.branchCode, class: "ALL", total: r.overall.total, onSchedule: r.overall.onSchedule, due: r.overall.due, overdue: r.overall.overdue, missed: r.overall.missed, compliancePercent: r.overall.compliancePercent });
    for (const cls of ["A", "B", "C"] as const) {
      const b = r.byClass[cls];
      flat.push({ branchCode: r.branchCode, class: cls, total: b.total, onSchedule: b.onSchedule, due: b.due, overdue: b.overdue, missed: b.missed, compliancePercent: b.compliancePercent });
    }
  }
  return {
    title: "Cycle Count Compliance KPI",
    columns: [
      { key: "branchCode", header: "Branch" },
      { key: "class", header: "ABC Class" },
      { key: "total", header: "Total scheduled" },
      { key: "onSchedule", header: "On schedule" },
      { key: "due", header: "Due" },
      { key: "overdue", header: "Overdue" },
      { key: "missed", header: "Missed" },
      { key: "compliancePercent", header: "Compliance (%)" },
    ],
    rows: flat,
  };
}

async function buildConsolidatedBranchViewTable(prisma: PrismaClient, actorRole: RoleName): Promise<ExportTable> {
  const rows = await getConsolidatedBranchStockView(prisma, { actorRole });
  const flat: Array<Record<string, string | number>> = [];
  for (const r of rows) {
    for (const b of Object.values(r.byBranch)) {
      flat.push({ sku: r.sku, productName: r.productName, branchCode: b.branchCode, quantityOnHand: b.quantityOnHand });
    }
  }
  return {
    title: "Consolidated Cross-Branch Stock",
    columns: [
      { key: "sku", header: "SKU" },
      { key: "productName", header: "Product" },
      { key: "branchCode", header: "Branch" },
      { key: "quantityOnHand", header: "Qty on hand" },
    ],
    rows: flat,
  };
}

async function buildQuarantineDisposalAgingTable(prisma: PrismaClient, actorRole: RoleName): Promise<ExportTable> {
  const { reports, certificates } = await getQuarantineDisposalAgingReport(prisma, { actorRole });
  const flat: Array<Record<string, string | number>> = [];
  for (const r of reports) {
    flat.push({ type: "QUARANTINE", id: r.id, sku: r.productVariant.sku, branchName: r.branch.name, quantity: r.quantity.toString(), status: r.status, daysDwelling: daysSince(r.quarantineEnteredAt) });
  }
  for (const c of certificates) {
    flat.push({ type: "FOR_DISPOSAL", id: c.id, sku: c.damageReport.productVariant.sku, branchName: c.damageReport.branch.name, quantity: c.quantity.toString(), status: c.disposition, daysDwelling: c.forDisposalEnteredAt ? daysSince(c.forDisposalEnteredAt) : 0 });
  }
  return {
    title: "Quarantine & Disposal Aging",
    columns: [
      { key: "type", header: "Type" },
      { key: "id", header: "ID" },
      { key: "sku", header: "SKU" },
      { key: "branchName", header: "Branch" },
      { key: "quantity", header: "Qty" },
      { key: "status", header: "Status / Disposition" },
      { key: "daysDwelling", header: "Days dwelling" },
    ],
    rows: flat,
  };
}

async function buildDamageVsShrinkageTable(prisma: PrismaClient, actorRole: RoleName): Promise<ExportTable> {
  const rows = await getDamageVsShrinkageReport(prisma, { actorRole });
  return {
    title: "Damage vs. Shrinkage",
    columns: [
      { key: "branchId", header: "Branch ID" },
      { key: "productVariantId", header: "Product Variant ID" },
      { key: "warehouseLocationId", header: "Location ID" },
      { key: "damageCount", header: "Damage reports" },
      { key: "adjCount", header: "ADJ-01 count" },
      { key: "adjValue", header: "ADJ-01 value (PHP)" },
      { key: "disproportionate", header: "Flagged" },
    ],
    rows: rows.map((r) => ({ ...r, adjValue: r.adjValue.toFixed(2), disproportionate: r.disproportionate ? "REVIEW" : "" })),
  };
}

/** Every category flattened uniformly, tagged by category — see dailyExceptionReport.ts for why this is a documented proxy in two places. */
async function buildDailyExceptionTable(prisma: PrismaClient, actorRole: RoleName, businessDate: Date): Promise<ExportTable> {
  const report = await generateDailyExceptionReport(prisma, { actorRole, businessDate });
  const flat: Array<Record<string, string | number>> = [];

  for (const a of report.adjustments) flat.push({ category: "Adjustment", id: a.id, occurredAt: a.createdAt.toISOString(), details: bigintSafeJson(a) });
  for (const c of report.countVariances) flat.push({ category: "CountVariance", id: c.id, occurredAt: c.createdAt.toISOString(), details: bigintSafeJson(c) });
  for (const l of report.blockedNegativeStockAttempts) flat.push({ category: "BlockedNegativeStock", id: l.id.toString(), occurredAt: l.createdAt.toISOString(), details: bigintSafeJson(l) });
  for (const e of report.lateEncodingsProxy) flat.push({ category: "LateEncodingProxy", id: e.receivingReportId, occurredAt: e.encodingStartedAt, details: bigintSafeJson(e) });
  for (const f of report.unaccountedFormsProxy) flat.push({ category: "UnaccountedFormsProxy", id: `${f.branchCode}-${f.documentType}`, occurredAt: "", details: bigintSafeJson(f) });
  for (const t of report.overdueTransfers) flat.push({ category: "OverdueTransfer", id: t.id, occurredAt: t.openedAt.toISOString(), details: bigintSafeJson(t) });
  for (const o of report.openDiscrepancyCases) flat.push({ category: "OpenDiscrepancyCase", id: o.id, occurredAt: o.openedAt.toISOString(), details: bigintSafeJson(o) });
  for (const p of report.overduePods) flat.push({ category: "OverduePod", id: p.id, occurredAt: p.openedAt.toISOString(), details: bigintSafeJson(p) });
  for (const e of report.emergencyElevations) flat.push({ category: "EmergencyElevation", id: e.id, occurredAt: e.grantedAt.toISOString(), details: bigintSafeJson(e) });

  return {
    title: `Daily Exception Report — ${report.businessDate}`,
    columns: [
      { key: "category", header: "Category" },
      { key: "id", header: "ID" },
      { key: "occurredAt", header: "Occurred At" },
      { key: "details", header: "Details (JSON)" },
    ],
    rows: flat,
  };
}

async function buildLowStockAlertsTable(prisma: PrismaClient, actorRole: RoleName): Promise<ExportTable> {
  const rows = await getLowStockAlerts(prisma, { actorRole });
  return {
    title: "Low Stock / Out of Stock Alerts",
    columns: [
      { key: "branchCode", header: "Branch" },
      { key: "sku", header: "SKU" },
      { key: "productName", header: "Product" },
      { key: "quantityOnHand", header: "On hand" },
      { key: "reorderPoint", header: "Reorder point" },
      { key: "status", header: "Status" },
    ],
    rows: rows.map((r) => ({ branchCode: r.branchCode, sku: r.sku, productName: r.productName, quantityOnHand: r.quantityOnHand, reorderPoint: r.reorderPoint, status: r.status })),
  };
}

async function buildDailyStockMovementTable(prisma: PrismaClient, actorRole: RoleName, branchId: string, businessDate: Date): Promise<ExportTable> {
  const summary = await getDailyStockMovementSummary(prisma, { actorRole, branchId, businessDate });
  return {
    title: `Daily Stock Movement Summary — ${summary.businessDate}`,
    columns: [
      { key: "movementType", header: "Movement Type" },
      { key: "referenceType", header: "Document Type" },
      { key: "documentCount", header: "Documents" },
      { key: "totalQuantity", header: "Total Qty" },
    ],
    rows: summary.lines.map((l) => ({ movementType: l.movementType, referenceType: l.referenceType, documentCount: l.documentCount, totalQuantity: l.totalQuantity })),
  };
}

async function buildVarianceAnalysisTable(prisma: PrismaClient, actorRole: RoleName): Promise<ExportTable> {
  const analysis = await getVarianceAnalysis(prisma, { actorRole });
  const flat: Array<Record<string, string | number>> = [];
  for (const p of analysis.byPerson) flat.push({ group: "By person", label: p.fullName, requestCount: p.requestCount, totalValue: p.totalValue });
  for (const l of analysis.byLocation) flat.push({ group: "By location", label: l.locationLabel, requestCount: l.requestCount, totalValue: l.totalValue });
  return {
    title: `Variance Analysis — trailing ${analysis.windowDays} days`,
    columns: [
      { key: "group", header: "Grouping" },
      { key: "label", header: "Name" },
      { key: "requestCount", header: "Adjustments" },
      { key: "totalValue", header: "Total Value (PHP)" },
    ],
    rows: flat,
  };
}

async function buildTrendReviewTable(prisma: PrismaClient, actorRole: RoleName): Promise<ExportTable> {
  const review = await getTrendReview(prisma, { actorRole });
  const flat: Array<Record<string, string | number>> = [];
  for (const w of review.weeklyTrend) flat.push({ section: "Weekly trend", key1: w.weekStart, key2: "", damageCount: w.damageCount, damageQuantity: w.damageQuantity, returnCount: w.returnCount, returnQuantity: w.returnQuantity });
  for (const s of review.slowStock) flat.push({ section: "Slow/dead stock", key1: s.sku, key2: s.productName, damageCount: "", damageQuantity: s.quantityOnHand, returnCount: "", returnQuantity: s.lastOutboundAt ?? "never" });
  return {
    title: `Damage/Return Trend & Slow-Stock Review — trailing ${review.windowDays} days`,
    columns: [
      { key: "section", header: "Section" },
      { key: "key1", header: "Week / SKU" },
      { key: "key2", header: "Product" },
      { key: "damageCount", header: "Damage count" },
      { key: "damageQuantity", header: "Damage qty / Qty on hand" },
      { key: "returnCount", header: "Return count" },
      { key: "returnQuantity", header: "Return qty / Last outbound" },
    ],
    rows: flat,
  };
}

export async function buildExportTable(
  prisma: PrismaClient,
  params: { reportId: string; actorRole: RoleName; businessDate?: Date; branchId?: string },
): Promise<ExportTable> {
  switch (params.reportId) {
    case "low-stock-alerts":
      return buildLowStockAlertsTable(prisma, params.actorRole);
    case "daily-stock-movement":
      if (!params.branchId) throw new Error('reportId "daily-stock-movement" requires a branchId query param.');
      return buildDailyStockMovementTable(prisma, params.actorRole, params.branchId, params.businessDate ?? new Date());
    case "variance-analysis":
      return buildVarianceAnalysisTable(prisma, params.actorRole);
    case "trend-review":
      return buildTrendReviewTable(prisma, params.actorRole);
    case "shrinkage-rate":
      return buildShrinkageRateTable(prisma, params.actorRole);
    case "cycle-count-compliance":
      return buildCycleCountComplianceTable(prisma, params.actorRole);
    case "consolidated-branch-view":
      return buildConsolidatedBranchViewTable(prisma, params.actorRole);
    case "quarantine-disposal-aging":
      return buildQuarantineDisposalAgingTable(prisma, params.actorRole);
    case "damage-vs-shrinkage":
      return buildDamageVsShrinkageTable(prisma, params.actorRole);
    case "daily-exception":
      return buildDailyExceptionTable(prisma, params.actorRole, params.businessDate ?? new Date());
    default:
      throw new UnknownReportIdError(`No exportable report with id "${params.reportId}".`);
  }
}
