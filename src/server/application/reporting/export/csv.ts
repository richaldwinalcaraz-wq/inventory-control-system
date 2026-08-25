import { stringify } from "csv-stringify/sync";
import type { ExportTable } from "./types";

export function toCsvBuffer(table: ExportTable): Buffer {
  const csv = stringify(table.rows, {
    header: true,
    columns: table.columns.map((c) => ({ key: c.key, header: c.header })),
  });
  return Buffer.from(csv, "utf-8");
}
