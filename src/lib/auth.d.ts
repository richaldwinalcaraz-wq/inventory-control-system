import { RoleName } from "@prisma/client";

declare module "next-auth" {
  interface User {
    role: RoleName;
    branchId: string | null;
  }

  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      role: RoleName;
      branchId: string | null;
    };
    /** Our own domain Session row's id (idle-lock + PIN-token association) — NOT the Auth.js JWT itself. */
    sessionId: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: RoleName;
    branchId: string | null;
    sessionId: string;
  }
}
