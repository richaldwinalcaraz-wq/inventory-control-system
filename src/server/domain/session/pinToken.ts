import bcrypt from "bcryptjs";
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = Prisma.TransactionClient | PrismaClient;

const PIN_TOKEN_TTL_SECONDS = Number(process.env.PIN_TOKEN_TTL_SECONDS ?? 60);

/** The submitted PIN did not match the user's stored pinHash, or the user has no PIN set. */
export class InvalidPinError extends Error {}

export interface IssuePinTokenParams {
  userId: string;
  sessionId: string;
  pin: string;
}

/**
 * Validates a PIN and mints a short-lived, single-use token proving fresh
 * re-auth. This is the mechanism behind G-30 ("forced re-auth before every
 * single posting, regardless of session freshness") — a real requirement
 * no standard session-expiry library solves out of the box, because it
 * fires on every post, not just after inactivity.
 */
export async function issuePinToken(db: Db, params: IssuePinTokenParams) {
  const user = await db.user.findUniqueOrThrow({ where: { id: params.userId } });
  if (!user.pinHash) {
    throw new InvalidPinError(`User ${params.userId} has no PIN configured.`);
  }
  const valid = await bcrypt.compare(params.pin, user.pinHash);
  if (!valid) {
    throw new InvalidPinError("Incorrect PIN.");
  }

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + PIN_TOKEN_TTL_SECONDS * 1000);
  return db.transactionPinToken.create({
    data: { userId: params.userId, sessionId: params.sessionId, issuedAt, expiresAt },
  });
}

/** No unconsumed, unexpired token exists for this id — reject the posting call. */
export class InvalidOrExpiredPinTokenError extends Error {}

/**
 * Atomically consumes a PIN token: exactly one caller can ever succeed for
 * a given token id, and only within its TTL. Implemented as a single
 * conditional UPDATE (not a read-then-write) so two concurrent posting
 * attempts using the same token can't both pass.
 */
export async function consumePinToken(
  tx: Prisma.TransactionClient,
  params: { pinTokenId: string; userId: string; forAction: string },
) {
  // Bind the current instant as a JS Date parameter rather than calling
  // Postgres's now() — now() is evaluated using the server's session
  // TimeZone GUC, which is NOT guaranteed to be UTC (this dev box defaults
  // to America/New_York), while every timestamp column here is `timestamp
  // without time zone` storing Prisma's UTC wall-clock values. Comparing a
  // UTC-wall-clock column against a locally-offset now() silently produces
  // wrong results instead of an error. A bound Date parameter goes through
  // the same UTC-consistent path Prisma's typed queries already use.
  const nowUtc = new Date();
  const rows = await tx.$queryRaw<{ id: string }[]>`
    UPDATE transaction_pin_token
    SET consumed_at = ${nowUtc}, consumed_for_action = ${params.forAction}
    WHERE id = ${params.pinTokenId}
      AND user_id = ${params.userId}
      AND consumed_at IS NULL
      AND expires_at > ${nowUtc}
    RETURNING id
  `;
  if (rows.length === 0) {
    throw new InvalidOrExpiredPinTokenError(
      `Pin token ${params.pinTokenId} is missing, already used, or expired — a fresh PIN entry is required for this action.`,
    );
  }
}
