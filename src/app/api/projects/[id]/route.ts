import { NextResponse } from "next/server";
import { requireUser } from "../../../../server/guard";
import { toErrorResponse } from "../../../../server/http";
import { projectPatchSchema, readJson } from "../../../../server/schemas";
import { deleteProject, updateProject } from "../../../../server/service";
import { serializeProject } from "../../../../server/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;
    const { id } = await ctx.params;
    const body = await readJson(req, projectPatchSchema);
    const row = await updateProject(auth.db, auth.user.id, id, body);
    return NextResponse.json(serializeProject(row));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;
    const { id } = await ctx.params;
    await deleteProject(auth.db, auth.user.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
