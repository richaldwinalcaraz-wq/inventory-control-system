import { type NextRequest, NextResponse } from "next/server";
import { getCurrentActor } from "@/server/http/currentActor";
import { parseBusinessDateParam } from "@/server/http/businessDate";
import { buildExportTable, UnsupportedExportFormatError } from "@/server/application/reporting/export/registry";
import { toCsvBuffer } from "@/server/application/reporting/export/csv";
import { toExcelBuffer } from "@/server/application/reporting/export/excel";
import { toPdfBuffer } from "@/server/application/reporting/export/pdf";
import { classifyError } from "@/server/http/errorCatalog";
import { fail } from "@/server/http/response";
import { prisma } from "@/lib/prisma";

const CONTENT_TYPES: Record<string, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

/**
 * The uniform export endpoint (Phase 4 plan sec.6/8) — every reportId in
 * export/registry.ts is reachable here in all three formats. Binary output,
 * so this bypasses apiHandler's JSON envelope; errors still go through the
 * same classifyError/fail path every other route uses for consistency.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ reportId: string }> }): Promise<NextResponse> {
  try {
    const { reportId } = await context.params;
    const actor = await getCurrentActor();
    const format = request.nextUrl.searchParams.get("format");
    if (!format || !(format in CONTENT_TYPES)) {
      throw new UnsupportedExportFormatError(`Unsupported or missing "format" query param: ${format}. Use csv, xlsx, or pdf.`);
    }

    const dateParam = request.nextUrl.searchParams.get("date");
    const businessDate = reportId === "daily-exception" || reportId === "daily-stock-movement" ? parseBusinessDateParam(dateParam) : undefined;
    const branchId = request.nextUrl.searchParams.get("branchId") ?? undefined;

    const table = await buildExportTable(prisma, { reportId, actorRole: actor.role, businessDate, branchId });

    let buffer: Buffer;
    if (format === "csv") buffer = toCsvBuffer(table);
    else if (format === "xlsx") buffer = await toExcelBuffer(table);
    else buffer = await toPdfBuffer(table);

    const filename = `${reportId}-${new Date().toISOString().slice(0, 10)}.${format}`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPES[format] as string,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const { status, code, message } = classifyError(err);
    return fail(code, message, status);
  }
}
