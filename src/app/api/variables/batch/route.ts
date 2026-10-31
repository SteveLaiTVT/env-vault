import { NextResponse } from "next/server";
import { requireUser } from "../../../../server/guard";
import { toErrorResponse } from "../../../../server/http";
import { batchSchema, readJson } from "../../../../server/schemas";
import { upsertVariable } from "../../../../server/service";
import { serializeVariable } from "../../../../server/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const body = await readJson(req, batchSchema);
    const rows = [];
    for (const item of body.items) {
      const row = await upsertVariable(ctx.db, ctx.user.id, item);
      if (row) rows.push(serializeVariable(row));
    }
    return NextResponse.json({ items: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}
