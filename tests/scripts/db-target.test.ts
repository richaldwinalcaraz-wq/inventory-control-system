// scripts/lib/db-target.ts: a script must never write to production just
// because .env points there.
import { describe, it, expect } from "vitest";
import { dbTargetOf, dbTargetProblem } from "../../scripts/lib/db-target";

const LOCAL = "postgresql://postgres:pw@localhost:5432/inventory_dev?schema=public";
const PROD = "postgresql://postgres.abc:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";

describe("Script database target guard", () => {
  it("treats localhost / 127.0.0.1 / ::1 as local and every other host as production", () => {
    expect(dbTargetOf(LOCAL)).toBe("local");
    expect(dbTargetOf("postgresql://u:p@127.0.0.1:5432/db")).toBe("local");
    expect(dbTargetOf("postgresql://u:p@[::1]:5432/db")).toBe("local");
    expect(dbTargetOf(PROD)).toBe("production");
  });

  it("runs on a local database without any flag", () => {
    expect(dbTargetProblem(LOCAL, [])).toBeNull();
    expect(dbTargetProblem(LOCAL, ["--dry-run"])).toBeNull();
  });

  it("refuses production unless --target=production is given", () => {
    expect(dbTargetProblem(PROD, [])).toContain("--target=production");
    expect(dbTargetProblem(PROD, ["--dry-run"])).not.toBeNull();
    expect(dbTargetProblem(PROD, ["--target=production"])).toBeNull();
  });

  it("refuses a flag that doesn't match the URL, an unknown target, and a missing or broken URL", () => {
    expect(dbTargetProblem(LOCAL, ["--target=production"])).toContain("local database");
    expect(dbTargetProblem(PROD, ["--target=prod"])).toContain("Unknown");
    expect(() => dbTargetProblem(undefined, [])).toThrow("not set");
    expect(() => dbTargetProblem("not a url", [])).toThrow("not a valid URL");
  });
});
