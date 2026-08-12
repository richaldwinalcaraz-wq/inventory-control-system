import { PrismaClient } from "@prisma/client";

// Singleton pattern: Next.js dev-mode hot-reload otherwise creates a new
// PrismaClient (and a new DB connection pool) on every file change.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
