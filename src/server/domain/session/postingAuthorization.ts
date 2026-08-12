import type { Prisma, Session } from "@prisma/client";
import { isSessionIdle, SessionIdleError } from "./idleLock";
import { consumePinToken } from "./pinToken";

/**
 * The single shared gate every posting/approval route must call — never
 * hand-roll these checks per route, or one missed route defeats the whole
 * control. Deliberately two independent checks, not one implying the
 * other:
 *
 *   1. Idle-lock: the session itself must not be stale (past
 *      IDLE_LOCK_MINUTES since last activity).
 *   2. Fresh PIN token: a valid, unconsumed, unexpired token must exist
 *      for THIS action — required on every single post regardless of how
 *      fresh the session is (G-30). A brand-new login is not exempt.
 *
 * Passing one never satisfies the other — see the plan's verification
 * checklist item 6, which specifically tests that a fresh session still
 * needs its own PIN token.
 */
export async function requirePostingAuthorization(
  tx: Prisma.TransactionClient,
  params: { session: Pick<Session, "id" | "userId" | "lastActiveAt">; pinTokenId: string; action: string },
) {
  if (isSessionIdle(params.session)) {
    throw new SessionIdleError(
      `Session ${params.session.id} has been idle past the allowed window — re-authenticate before posting.`,
    );
  }

  await consumePinToken(tx, {
    pinTokenId: params.pinTokenId,
    userId: params.session.userId,
    forAction: params.action,
  });

  await tx.session.update({ where: { id: params.session.id }, data: { lastActiveAt: new Date() } });
}

export { SessionIdleError } from "./idleLock";
export { InvalidOrExpiredPinTokenError } from "./pinToken";
