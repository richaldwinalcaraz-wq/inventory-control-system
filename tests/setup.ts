// Runs before every test file. Must load .env.test — and override any
// already-set DATABASE_URL — before any test file imports @prisma/client,
// since PrismaClient's own internal dotenv auto-load would otherwise pick
// up the dev .env first and silently point every test at inventory_dev.
import dotenv from "dotenv";
dotenv.config({ path: ".env.test", override: true });
