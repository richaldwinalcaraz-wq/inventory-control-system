import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { createParentSchema } from "@/server/http/catalogSchemas";
import { createParentAsin } from "@/server/application/catalog/parentAsins";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, createParentSchema);
  return createParentAsin(prisma, { ...body, actorRole: actor.role, actorUserId: actor.userId });
});
