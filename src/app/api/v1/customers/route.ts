import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ name: z.string().min(1), contactPhone: z.string().min(1).optional() });

export const POST = apiHandler(async (request) => {
  await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  return prisma.customer.create({ data: body });
});

export const GET = apiHandler(async () => {
  await getCurrentActor();
  return prisma.customer.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, contactPhone: true } });
});
