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
