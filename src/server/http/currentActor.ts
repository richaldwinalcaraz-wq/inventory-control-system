import type { RoleName, Session } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export class UnauthenticatedError extends Error {}

export interface CurrentActor {
  userId: string;
  role: RoleName;
  branchId: string | null;
  session: Session;
}

interface AugmentedAuthSession {
  user: { id: string; role: RoleName; branchId: string | null };
  sessionId: string;
}

/**
 * The one place every API route resolves "who is calling, with what
 * role, in what domain session" — never re-derived ad hoc per route.
 * Also where the idle-lock clock gets touched: every authenticated
 * request updates Session.lastActiveAt, not just posting actions (the
 * posting-specific re-check happens separately in
 * requirePostingAuthorization).
 */
export async function getCurrentActor(): Promise<CurrentActor> {
  const rawSession = await auth();
  if (!rawSession) {
    throw new UnauthenticatedError("Not signed in.");
  }
  // Same NextAuth v5 beta type-augmentation quirk documented in auth.ts —
  // our module augmentation isn't reliably picked up outside its own
  // callback bodies, so we cast past it explicitly here too.
  const authSession = rawSession as unknown as AugmentedAuthSession;
  if (!authSession.user?.id || !authSession.sessionId) {
    throw new UnauthenticatedError("Not signed in.");
  }

  const session = await prisma.session.update({
    where: { id: authSession.sessionId },
    data: { lastActiveAt: new Date() },
  });

  return {
    userId: authSession.user.id,
    role: authSession.user.role,
    branchId: authSession.user.branchId,
    session,
  };
}
