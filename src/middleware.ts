import { NextResponse, type NextRequest } from "next/server";

/**
 * Temporary deployment-scope gate — the client asked to launch with only
 * a subset of already-built features visible. Nothing listed here is
 * deleted; every hidden page/route still exists and works, it's just
 * unreachable while its path isn't in these lists. Restoring a feature
 * later is a one-line change here (plus adding it back to nav-items.ts) —
 * no code needs to be rewritten.
 *
 * Page routes: an exact match against ALLOWED_EXACT_PAGES, or a prefix
 * match against ALLOWED_PAGE_PREFIXES, is required — or the request is
 * redirected to "/", same behavior the app already uses for a
 * permission-denied page, so a hidden page reads as "not here" rather
 * than a broken link or a 404.
 *
 * API routes: BLOCKED_API_PREFIXES denies the mutation/query endpoints
 * that belong exclusively to a hidden module. Shared plumbing (auth,
 * session/PIN, the generic supplier/customer/product-variant lookups no
 * current page even calls) is deliberately left alone.
 */
// Pages that own a whole subtree (their own [id]/new/etc. child routes).
const ALLOWED_PAGE_PREFIXES = ["/receiving", "/disposal"];

// Leaf pages only — listing "/inventory" here as a PREFIX would also allow
// "/inventory/transfer" (Counter Replenishment, not approved), since that
// path starts with "/inventory/" too. Every inventory sub-page that IS
// approved is listed individually instead.
const ALLOWED_EXACT_PAGES = ["/", "/login", "/inventory", "/inventory/new", "/inventory/low-stock", "/inventory/reorder-points", "/reports/daily-exception", "/reports/shrinkage-rate"];

const BLOCKED_API_PREFIXES = [
  "/api/v1/retail-sales",
  "/api/v1/sales-orders",
  "/api/v1/releases",
  "/api/v1/returns",
  "/api/v1/adjustments",
  "/api/v1/transfer",
  "/api/v1/inventory/transfer",
  "/api/v1/gate-log",
  "/api/v1/integrity-checks",
  "/api/v1/cycle-count",
  "/api/v1/reconciliation",
  "/api/v1/discrepancy-cases",
  "/api/v1/reports/cycle-count-compliance",
];

const ALLOWED_REPORT_EXPORT_IDS = new Set(["consolidated-branch-view", "low-stock-alerts", "daily-exception", "shrinkage-rate"]);

function isAllowedPage(pathname: string): boolean {
  if (ALLOWED_EXACT_PAGES.includes(pathname)) return true;
  return ALLOWED_PAGE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (BLOCKED_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      return NextResponse.json({ data: null, error: { code: "FEATURE_DISABLED", message: "This feature is currently disabled." }, meta: null }, { status: 404 });
    }
    const exportMatch = pathname.match(/^\/api\/v1\/reports\/([^/]+)\/export/);
    if (exportMatch && !ALLOWED_REPORT_EXPORT_IDS.has(exportMatch[1] ?? "")) {
      return NextResponse.json({ data: null, error: { code: "FEATURE_DISABLED", message: "This report is currently disabled." }, meta: null }, { status: 404 });
    }
    return NextResponse.next();
  }

  if (!isAllowedPage(pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
