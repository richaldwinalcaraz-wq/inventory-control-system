// Creates the dedicated inventory_test database (idempotent — Postgres has
// no `CREATE DATABASE IF NOT EXISTS`, so this checks first) and migrates +
// seeds it. Run via `npm run db:test:setup` before the regression suite.
// See tests/setup.ts for how tests themselves point at this same database.
import dotenv from "dotenv";
dotenv.config({ path: ".env.test", override: true });

import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const TEST_DB_NAME = "inventory_test";

// Reuses the already-installed @prisma/client for the one-time admin
// connection instead of adding a raw `pg` dependency just for this bootstrap
// step — Prisma 6's query engine talks Postgres directly, no `pg` package
// needed, and PrismaClient accepts a datasource URL override at construction.
async function ensureDatabaseExists() {
  const testUrl = new URL(process.env.DATABASE_URL ?? "");
  if (testUrl.pathname.replace(/^\//, "") !== TEST_DB_NAME) {
    throw new Error(`Refusing to run — DATABASE_URL in .env.test does not point at ${TEST_DB_NAME}: ${testUrl.pathname}`);
  }

  const adminUrl = new URL(testUrl.toString());
  adminUrl.pathname = "/postgres"; // maintenance DB, always present
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    const rows = await admin.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists`,
      TEST_DB_NAME,
    );
    if (!rows[0]?.exists) {
      // CREATE DATABASE can't be parameterized or run inside a transaction block.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB_NAME}"`);
      console.log(`Created database "${TEST_DB_NAME}".`);
    } else {
      console.log(`Database "${TEST_DB_NAME}" already exists.`);
    }
  } finally {
    await admin.$disconnect();
  }
}

async function main() {
  await ensureDatabaseExists();

  console.log("Applying migrations to the test DB...");
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  console.log("Seeding the test DB...");
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env: process.env });

  console.log("Test DB ready.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
