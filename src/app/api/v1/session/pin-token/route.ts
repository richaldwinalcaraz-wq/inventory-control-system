import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { assertPermission } from "@/server/domain/rbac/assertPermission";
import { issuePinToken } from "@/server/domain/session/pinToken";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ pin: z.string().min(1) });

export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  await assertPermission(prisma, { role: actor.role, action: "session.pin-token.issue" });
  const body = await parseBody(request, bodySchema);

  const token = await issuePinToken(prisma, { userId: actor.userId, sessionId: actor.session.id, pin: body.pin });
  return { id: token.id, expiresAt: token.expiresAt };
});
