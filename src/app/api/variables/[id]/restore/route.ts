import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "../../../../../server/guard";
import { toErrorResponse } from "../../../../../server/http";
import { readJson } from "../../../../../server/schemas";
import { restoreVersion } from "../../../../../server/service";
import { serializeVariable } from "../../../../../server/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;
    const { id } = await ctx.params;
    const body = await readJson(req, z.object({ versionId: z.string().uuid() }));
    const row = await restoreVersion(auth.db, auth.user.id, id, body.versionId);
    if (!row) return NextResponse.json({ error: "NOT_FOUND", message: "变量不存在" }, { status: 404 });
    return NextResponse.json(serializeVariable(row));
  } catch (err) {
    return toErrorResponse(err);
  }
}
