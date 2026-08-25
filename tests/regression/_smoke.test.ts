// Infra smoke test — proves the regression suite is actually wired to the
// dedicated inventory_test DB (not inventory_dev) before any of the 35
// finding files are trusted. Not a fraud-audit finding itself.
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";

describe("regression suite infrastructure", () => {
  it("connects to inventory_test, not inventory_dev", () => {
    expect(process.env.DATABASE_URL).toContain("inventory_test");
  });

  it("can query the seeded test DB", async () => {
    const prisma = new PrismaClient();
    try {
      const owner = await prisma.user.findUnique({ where: { username: "owner" } });
      expect(owner).not.toBeNull();
      expect(owner?.role).toBe("OWNER");
    } finally {
      await prisma.$disconnect();
    }
  });
});
