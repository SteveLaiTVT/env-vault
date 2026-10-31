import { NextResponse } from "next/server";
import { requireUser } from "../../../server/guard";
import { toErrorResponse } from "../../../server/http";
import { cipherSchema, readJson } from "../../../server/schemas";
import { upsertVariable } from "../../../server/service";
import { serializeVariable } from "../../../server/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const body = await readJson(req, cipherSchema);
    const row = await upsertVariable(ctx.db, ctx.user.id, body);
    if (!row) return NextResponse.json({ error: "INTERNAL", message: "服务暂时不可用" }, { status: 500 });
    return NextResponse.json(serializeVariable(row), { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
