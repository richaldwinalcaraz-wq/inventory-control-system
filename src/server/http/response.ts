import { NextResponse } from "next/server";

// bigint (stock_ledger.id/sequenceNo, audit_log.id) has no native JSON
// representation — JSON.stringify throws on it rather than silently
// dropping it. Converting to string here, once, is safer than requiring
// every route to remember to do it themselves.
//
// Deliberately leaves anything with its own toJSON() (Decimal, Date)
// untouched rather than recursing into it: Date has no enumerable own
// properties, so a naive Object.entries() walk would silently collapse
// every timestamp in every API response into `{}`. Decimal's internal
// digit-array representation would be similarly mangled. Both serialize
// correctly on their own once handed to JSON.stringify downstream.
function serializeBigInts(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return value;
  }
  if (Array.isArray(value)) return value.map(serializeBigInts);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serializeBigInts(v)]));
  }
  return value;
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data: serializeBigInts(data), error: null, meta: null }, { status });
}

export function fail(code: string, message: string, status: number) {
  return NextResponse.json({ data: null, error: { code, message }, meta: null }, { status });
}
