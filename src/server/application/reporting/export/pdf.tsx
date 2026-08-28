import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { ExportTable } from "./types";

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 8 },
  title: { fontSize: 14, marginBottom: 12, fontWeight: 700 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", paddingVertical: 4 },
  headerRow: { flexDirection: "row", borderBottomWidth: 2, borderBottomColor: "#0f172a", paddingVertical: 4 },
  cell: { flex: 1, paddingHorizontal: 4 },
  headerCell: { flex: 1, paddingHorizontal: 4, fontWeight: 700 },
});

function ExportDocument({ table }: { table: ExportTable }) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>{table.title}</Text>
        <View style={styles.headerRow}>
          {table.columns.map((c) => (
            <Text key={c.key} style={styles.headerCell}>
              {c.header}
            </Text>
          ))}
        </View>
        {table.rows.map((row, i) => (
          <View key={i} style={styles.row}>
            {table.columns.map((c) => (
              <Text key={c.key} style={styles.cell}>
                {String(row[c.key] ?? "")}
              </Text>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function toPdfBuffer(table: ExportTable): Promise<Buffer> {
  const buffer = await renderToBuffer(<ExportDocument table={table} />);
  return Buffer.from(buffer);
}
