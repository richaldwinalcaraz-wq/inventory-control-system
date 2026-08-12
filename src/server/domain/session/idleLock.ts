import type { Prisma, PrismaClient, Session } from "@prisma/client";

type Db = Prisma.TransactionClient | PrismaClient;

const IDLE_LOCK_MINUTES = Number(process.env.IDLE_LOCK_MINUTES ?? 3);

/** The session's last activity is older than IDLE_LOCK_MINUTES. */
export class SessionIdleError extends Error {}

export function isSessionIdle(session: Pick<Session, "lastActiveAt">, now: Date = new Date()): boolean {
  const idleMs = now.getTime() - session.lastActiveAt.getTime();
  return idleMs > IDLE_LOCK_MINUTES * 60 * 1000;
}

/** Called on every authenticated request (not just posting) to keep the idle clock current. */
export async function touchSession(db: Db, sessionId: string) {
  await db.session.update({ where: { id: sessionId }, data: { lastActiveAt: new Date() } });
}
