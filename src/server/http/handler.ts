import { type NextRequest, NextResponse } from "next/server";
import { classifyError } from "./errorCatalog";
import { ok, fail } from "./response";

interface RouteContext<P> {
  params: Promise<P>;
}

/**
 * Wraps a route's actual logic with consistent error->HTTP mapping (see
 * errorCatalog.ts) and the {data,error,meta} envelope — every route
 * handler in this app goes through this, not a hand-rolled try/catch.
 * Next.js 16 makes route params async, hence the Promise unwrap here.
 */
export function apiHandler<P = Record<string, string>>(fn: (request: NextRequest, params: P) => Promise<unknown>) {
  return async (request: NextRequest, context: RouteContext<P>): Promise<NextResponse> => {
    try {
      const params = await context.params;
      const data = await fn(request, params);
      return ok(data);
    } catch (err) {
      const { status, code, message } = classifyError(err);
      return fail(code, message, status);
    }
  };
}
