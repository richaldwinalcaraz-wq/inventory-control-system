// G-13 — Discounting has no real-time secondary control.
// SYSTEM RULE (per BPD sec.8.1's own build-scope note): retail sells at
// list price only — discounting is explicitly deferred to a future POS
// module. Confirmed directly: no discount field exists on RetailSale/
// RetailSaleLine, and no Manager-PIN-at-threshold gate exists anywhere in
// retail or wholesale code.
// This finding is NOT a testing gap disguised as a feature gap — it's a
// genuinely, deliberately unbuilt control, and the audit's own DETECTION
// half is consequently unimplementable too (nothing to detect on).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";

// Strips `// ...` line comments before scanning — several real comments in
// this codebase legitimately explain the ABSENCE of discounting ("list
// price only... discounting belongs to a future POS module"), which would
// false-positive a raw substring match against the word "discount" and
// silently flip these tests from [GAP] (failing, correct) to passing
// (wrong — the control is still unbuilt, only the comment mentions it).
function stripLineComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "") // block/JSDoc comments — most of the "discounting" mentions live in these
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function findSchemaFields(schemaPath: string, modelName: string): string {
  const content = readFileSync(schemaPath, "utf-8");
  const match = content.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Model ${modelName} not found in schema.prisma`);
  return stripLineComments(match[1] ?? "");
}

describe("G-13: discount control", () => {
  it("[GAP] SYSTEM RULE: no discount field exists on RetailSaleLine — confirmed against the live schema", () => {
    const schemaPath = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));
    const fields = findSchemaFields(schemaPath, "RetailSaleLine");
    const hasDiscountField = /discount/i.test(fields);
    if (hasDiscountField) {
      // If this ever fails, a discount field WAS added — this test's job
      // is done and it should be replaced with a real rule/detect test.
      return;
    }
    throw new Error(
      "[GAP] G-13 SYSTEM RULE: RetailSaleLine has no discount-related field at all — BPD sec.8.1's own note defers " +
        "discounting to a future POS module. There is consequently no Manager-PIN-at-threshold gate to test, and " +
        "no discount data for a DETECTION report to review. This is a deliberate, out-of-scope gap, not an oversight.",
    );
  });

  it("[GAP] confirms no discount-PIN gate exists anywhere in retail or wholesale application code", () => {
    const retailDir = fileURLToPath(new URL("../../src/server/application/retail", import.meta.url));
    const wholesaleDir = fileURLToPath(new URL("../../src/server/application/wholesale", import.meta.url));
    const readAll = (dir: string) => readdirSync(dir).map((f) => stripLineComments(readFileSync(`${dir}/${f}`, "utf-8"))).join("\n");
    const combined = readAll(retailDir) + readAll(wholesaleDir);
    if (/discount/i.test(combined)) return;
    throw new Error("[GAP] G-13: no file's actual code (comments excluded) in retail/ or wholesale/ application code references 'discount' — confirms the control is entirely unbuilt.");
  });
});
