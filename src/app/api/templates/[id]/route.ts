import { NextResponse } from "next/server";
import { requireUser } from "../../../../server/guard";
import { toErrorResponse } from "../../../../server/http";
import { deleteTemplate } from "../../../../server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;
    const { id } = await ctx.params;
    await deleteTemplate(auth.db, auth.user.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
