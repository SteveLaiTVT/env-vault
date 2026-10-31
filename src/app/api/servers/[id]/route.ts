import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "../../../../server/guard";
import { toErrorResponse } from "../../../../server/http";
import { readJson } from "../../../../server/schemas";
import { deleteServer, updateServer } from "../../../../server/service";
import { serializeServer } from "../../../../server/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  note: z.string().max(2000).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;
    const { id } = await ctx.params;
    const body = await readJson(req, patchSchema);
    const row = await updateServer(auth.db, auth.user.id, id, body);
    return NextResponse.json(serializeServer(row));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;
    const { id } = await ctx.params;
    await deleteServer(auth.db, auth.user.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
