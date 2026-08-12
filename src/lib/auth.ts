import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Credentials provider only — named internal staff accounts (BR-078),
  // never shared logins, never social login. See business-process-design.md sec.4.
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;
        const { username, password } = parsed.data;

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) return null;
        if (user.status === "DEACTIVATED") return null;

        const passwordValid = await bcrypt.compare(password, user.passwordHash);
        if (!passwordValid) return null;

        return {
          id: user.id,
          name: user.fullName,
          email: user.email ?? undefined,
          role: user.role,
          branchId: user.branchId,
        };
      },
    }),
  ],
  session: {
    // JWT strategy: this session answers "who is this," not "can they post
    // right now." The idle-lock and forced-re-auth-before-posting checks
    // (G-30) are separate mechanisms layered on top — see src/server/domain/rbac.
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // `user` here is exactly what authorize() returned above — cast
        // past next-auth's built-in User type, which our module
        // augmentation in auth.d.ts doesn't always get picked up for in
        // this callback's inferred signature.
        const appUser = user as unknown as { id: string; role: string; branchId: string | null };
        token.role = appUser.role;
        token.branchId = appUser.branchId;

        // `user` is only populated on the initial sign-in call (not on
        // every subsequent request the JWT strategy re-validates), so
        // this is exactly the "log in" moment — mint our own domain
        // Session row here. This is deliberately NOT the same thing as
        // the Auth.js JWT itself: it's what the idle-lock check
        // (lastActiveAt) and every TransactionPinToken hang off of.
        const domainSession = await prisma.session.create({
          data: {
            userId: appUser.id,
            lastActiveAt: new Date(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // outer bound only — idle-lock/PIN-token are the real boundaries
          },
        });
        token.sessionId = domainSession.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const appSessionUser = session.user as unknown as {
          id: string;
          role: string;
          branchId: string | null;
        };
        appSessionUser.id = token.sub as string;
        appSessionUser.role = token.role as string;
        appSessionUser.branchId = token.branchId as string | null;
      }
      (session as unknown as { sessionId: string }).sessionId = token.sessionId as string;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
