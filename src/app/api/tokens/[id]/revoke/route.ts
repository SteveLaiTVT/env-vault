import { NextResponse } from "next/server";
import { requireUser } from "../../../../../server/guard";
import { toErrorResponse } from "../../../../../server/http";
import { revokeToken } from "../../../../../server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;
    const { id } = await ctx.params;
    await revokeToken(auth.db, auth.user.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
