import ExcelJS from "exceljs";
import type { ExportTable } from "./types";

export async function toExcelBuffer(table: ExportTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(table.title.slice(0, 31)); // Excel sheet-name limit

  worksheet.columns = table.columns.map((c) => ({ key: c.key, header: c.header, width: Math.max(c.header.length + 2, 12) }));
  worksheet.getRow(1).font = { bold: true };
  worksheet.addRows(table.rows);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
