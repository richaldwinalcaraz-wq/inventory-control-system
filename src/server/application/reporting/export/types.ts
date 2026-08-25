export interface ExportColumn {
  key: string;
  header: string;
}

export interface ExportTable {
  title: string;
  columns: ExportColumn[];
  rows: Array<Record<string, string | number>>;
}
