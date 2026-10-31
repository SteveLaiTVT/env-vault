import { NextResponse } from "next/server";
import { requireUser } from "../../../../server/guard";
import { toErrorResponse } from "../../../../server/http";
import { cipherSchema, readJson } from "../../../../server/schemas";
import { deleteVariable, upsertVariable } from "../../../../server/service";
import { serializeVariable } from "../../../../server/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;
    await ctx.params;
    const body = await readJson(req, cipherSchema);
    const row = await upsertVariable(auth.db, auth.user.id, body);
    if (!row) return NextResponse.json({ error: "INTERNAL", message: "服务暂时不可用" }, { status: 500 });
    return NextResponse.json(serializeVariable(row));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;
    const { id } = await ctx.params;
    await deleteVariable(auth.db, auth.user.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
