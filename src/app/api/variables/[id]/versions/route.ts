import { NextResponse } from "next/server";
import { requireUser } from "../../../../../server/guard";
import { toErrorResponse } from "../../../../../server/http";
import { listVersions } from "../../../../../server/service";
import { serializeVersion } from "../../../../../server/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;
    const { id } = await ctx.params;
    const rows = await listVersions(auth.db, auth.user.id, id);
    return NextResponse.json({ items: rows.map(serializeVersion) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
