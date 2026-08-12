import type { RoleName } from "@prisma/client";
import { auth } from "./auth";

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
 */
export async function getAppSession(): Promise<{ user: AppUser; sessionId: string } | null> {
  const raw = await auth();
  if (!raw?.user) return null;
  return raw as unknown as { user: AppUser; sessionId: string };
}
