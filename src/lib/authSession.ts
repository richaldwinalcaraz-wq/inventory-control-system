import { cache } from "react";
import type { RoleName } from "@prisma/client";
import { auth } from "./auth";
import { prisma } from "./prisma";

export interface AppUser {
  id: string;
  name?: string | null;
  email?: string | null;
  role: RoleName;
  branchId: string | null;
}

/**
 * Typed wrapper around auth() — NextAuth v5 beta's module augmentation
 * (auth.d.ts) isn't reliably picked up by TS outside auth.ts's own
 * callback bodies, so every call site otherwise needs its own cast. This
 * is the one place that cast lives for Server Components/pages.
 *
 * Also re-checks the account on every request: the JWT outlives a
 * deactivation by up to 30 days, so a deactivated user or revoked session
 * reads as signed out. cache() keeps it to one lookup per render.
 */
export const getAppSession = cache(async (): Promise<{ user: AppUser; sessionId: string } | null> => {
  const raw = await auth();
  if (!raw?.user) return null;
  const appSession = raw as unknown as { user: AppUser; sessionId: string };
  if (!appSession.sessionId) return null;

  const domainSession = await prisma.session.findUnique({
    where: { id: appSession.sessionId },
    select: { revokedAt: true, user: { select: { status: true } } },
  });
  if (!domainSession || domainSession.revokedAt || domainSession.user.status === "DEACTIVATED") return null;

  return appSession;
});
