// One-off: replaces every seeded user's shared dev password
// ("Password123!", from prisma/seed.ts's DEV_PASSWORD) with its own strong
// random password, printed once below. Run this against a real database
// before handing out logins — the seed password is fine for local dev
// only. There is no in-app "change password" flow yet, so capture these
// now; re-run this script later to rotate again if one leaks.
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";

function generatePassword(): string {
  // 18 random bytes, base64url-encoded (~24 chars, URL/shell-safe, no
  // ambiguous punctuation to transcribe).
  return randomBytes(18).toString("base64url");
}

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, role: true },
    orderBy: { username: "asc" },
  });

  if (users.length === 0) {
    console.log("No users found — nothing to rotate.");
    return;
  }

  const rows: Array<{ username: string; role: string; password: string }> = [];
  for (const user of users) {
    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    rows.push({ username: user.username, role: user.role, password });
  }

  console.log(`\nRotated ${rows.length} password(s). Save these now — they will not be shown again:\n`);
  console.table(rows);
  console.log("Store this list somewhere secure (password manager) and distribute individually — do not leave it in shell history or logs.\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
