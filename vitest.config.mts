import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./src/*" path alias, since Vite's
    // resolver doesn't read tsconfig paths automatically.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    root: "tests",
    environment: "node",
    setupFiles: ["./setup.ts"],
    // All finding files run sequentially against one shared inventory_test
    // DB (mutex-row locks, hash-chain sequencing, and RBAC seed rows are
    // cross-file shared state) — see vitest.config.ts's note in the Phase 5
    // plan for why parallel file execution is the wrong default here.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
