// Asia/Manila is UTC+8 with no DST — a fixed offset is safe here. Every
// "what calendar day is this for a Manila-based user/business" question
// (SoD day-scoping, reconciliation/report business dates, elevation expiry)
// must go through these two functions, not raw Date.UTC(...) — a raw-UTC
// day boundary is silently wrong for up to 8 hours a day. See the
// 2026-08-19 close-out lesson in app-build-sop.md: fixing one call site and
// leaving a "the same fix likely applies elsewhere" note is not a fix, it's
// a delayed recurrence.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

export function startOfDayManila(now: Date = new Date()): Date {
  const manilaNow = new Date(now.getTime() + MANILA_OFFSET_MS);
  const manilaMidnight = Date.UTC(manilaNow.getUTCFullYear(), manilaNow.getUTCMonth(), manilaNow.getUTCDate());
  return new Date(manilaMidnight - MANILA_OFFSET_MS);
}

export function endOfDayManila(now: Date = new Date()): Date {
  const manilaNow = new Date(now.getTime() + MANILA_OFFSET_MS);
  const manilaMidnightNext = Date.UTC(manilaNow.getUTCFullYear(), manilaNow.getUTCMonth(), manilaNow.getUTCDate() + 1);
  return new Date(manilaMidnightNext - MANILA_OFFSET_MS);
}
