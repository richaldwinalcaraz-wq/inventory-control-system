import type { NextRequest } from "next/server";
import type { z } from "zod";

export class InvalidRequestBodyError extends Error {}

export async function parseBody<T extends z.ZodTypeAny>(request: NextRequest, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new InvalidRequestBodyError("Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new InvalidRequestBodyError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

/** Validates the URL query string the same way parseBody validates a JSON body (400 on failure). */
export function parseQuery<T extends z.ZodTypeAny>(request: NextRequest, schema: T): z.infer<T> {
  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    throw new InvalidRequestBodyError(parsed.error.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`).join("; "));
  }
  return parsed.data;
}
