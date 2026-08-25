// G-30 — Shared or unattended terminal sessions allow impersonation of a
// named user.
// SYSTEM RULE: idle-lock (session staleness) AND a fresh, single-use PIN
// token are two INDEPENDENT gates — passing one never satisfies the other.
// A brand-new, definitely-not-idle session still needs its own fresh PIN
// token for every single posting action.
// DETECTION: no session-gap/implausible-interval pattern report exists.
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { requirePostingAuthorization } from "../../src/server/domain/session/postingAuthorization";
import { SessionIdleError } from "../../src/server/domain/session/idleLock";
import { issuePinToken, InvalidOrExpiredPinTokenError } from "../../src/server/domain/session/pinToken";
import { getUserByRole } from "./helpers/receiving";

const prisma = new PrismaClient();
const createdSessionIds: string[] = [];

describe("G-30: idle-lock + posting PIN", () => {
  it("[rule] a freshly-created (not idle) session with NO pin token is still blocked from posting", async () => {
    const user = await getUserByRole(prisma, "encoder");
    const session = await prisma.session.create({ data: { userId: user.id, lastActiveAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) } });
    createdSessionIds.push(session.id);

    await prisma.$transaction(async (tx) => {
      await expect(
        requirePostingAuthorization(tx, { session, pinTokenId: "00000000-0000-0000-0000-000000000000", action: "test.posting" }),
      ).rejects.toThrow(InvalidOrExpiredPinTokenError);
    });
  });

  it("[rule] an idle session is blocked regardless of whether a valid PIN token is supplied", async () => {
    const user = await getUserByRole(prisma, "encoder");
    const staleLastActive = new Date(Date.now() - 60 * 60 * 1000); // 1h ago, well past IDLE_LOCK_MINUTES
    const session = await prisma.session.create({ data: { userId: user.id, lastActiveAt: staleLastActive, expiresAt: new Date(Date.now() + 3600_000) } });
    createdSessionIds.push(session.id);
    const pinToken = await issuePinToken(prisma, { userId: user.id, sessionId: session.id, pin: "1234" });

    await prisma.$transaction(async (tx) => {
      await expect(
        requirePostingAuthorization(tx, { session, pinTokenId: pinToken.id, action: "test.posting" }),
      ).rejects.toThrow(SessionIdleError);
    });
  });

  it("[rule] a valid PIN token is single-use — reusing it for a second posting action fails", async () => {
    const user = await getUserByRole(prisma, "encoder");
    const session = await prisma.session.create({ data: { userId: user.id, lastActiveAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) } });
    createdSessionIds.push(session.id);
    const pinToken = await issuePinToken(prisma, { userId: user.id, sessionId: session.id, pin: "1234" });

    await prisma.$transaction(async (tx) => {
      await requirePostingAuthorization(tx, { session, pinTokenId: pinToken.id, action: "test.posting.first" });
    });

    await prisma.$transaction(async (tx) => {
      await expect(
        requirePostingAuthorization(tx, { session, pinTokenId: pinToken.id, action: "test.posting.second" }),
      ).rejects.toThrow(InvalidOrExpiredPinTokenError);
    });
  });

  it("[GAP] DETECTION: no session-gap/implausible-posting-interval pattern report exists", () => {
    throw new Error(
      "[GAP] G-30 DETECTION: no report anywhere in src/server/application flags long-idle-then-post patterns or " +
        "implausibly-short intervals between transactions under one session — a shared/unattended terminal being " +
        "actively misused (as opposed to blocked outright by the PIN gate) leaves no reviewable pattern signal.",
    );
  });
});

afterAll(async () => {
  await prisma.transactionPinToken.deleteMany({ where: { sessionId: { in: createdSessionIds } } });
  await prisma.session.deleteMany({ where: { id: { in: createdSessionIds } } });
  await prisma.$disconnect();
});
