// Every script that writes to the database calls assertDbTarget() first.
// .env points at production, so "remember to override DATABASE_URL" is not
// a safeguard on its own: a script refuses a non-local database unless it
// is run with --target=production, and refuses --target=production against
// a local one (the flag must match where it will actually write).

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Where `databaseUrl` points: "local" for this machine, "production" for anything else. Throws on a missing or unreadable URL. */
export function dbTargetOf(databaseUrl: string | undefined): "local" | "production" {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set.");
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }
  return LOCAL_HOSTS.has(host) ? "local" : "production";
}

/** Returns why `argv` and `databaseUrl` don't agree on the target, or null when the script may run. Pure, for tests. */
export function dbTargetProblem(databaseUrl: string | undefined, argv: readonly string[]): string | null {
  const target = dbTargetOf(databaseUrl);
  const flag = argv.find((a) => a.startsWith("--target="))?.slice("--target=".length);
  if (flag !== undefined && flag !== "production") return `Unknown --target=${flag}. The only accepted value is --target=production.`;
  if (target === "production" && flag !== "production") {
    return "DATABASE_URL points at a non-local (production) database. Re-run with --target=production if that is really intended, or point DATABASE_URL at your local database.";
  }
  if (target === "local" && flag === "production") return "--target=production was given, but DATABASE_URL points at a local database.";
  return null;
}

/** Exits the script with a clear message unless the target matches DATABASE_URL. Prints the host it will write to. */
export function assertDbTarget(scriptName: string, argv: readonly string[] = process.argv.slice(2)): void {
  let problem: string | null;
  try {
    problem = dbTargetProblem(process.env.DATABASE_URL, argv);
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err);
  }
  if (problem) {
    console.error(`${scriptName}: refusing to run. ${problem}`);
    process.exit(1);
  }
  console.log(`${scriptName}: writing to ${new URL(process.env.DATABASE_URL!).host}${new URL(process.env.DATABASE_URL!).pathname}`);
}
