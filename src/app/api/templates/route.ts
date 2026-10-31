import { NextResponse } from "next/server";
import { requireUser } from "../../../server/guard";
import { toErrorResponse } from "../../../server/http";
import { readJson, templateSchema } from "../../../server/schemas";
import { saveTemplate } from "../../../server/service";
import { serializeTemplate } from "../../../server/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const body = await readJson(req, templateSchema);
    const row = await saveTemplate(ctx.db, ctx.user.id, body.name, body.bodyCipher, body.bodyIv);
    if (!row) return NextResponse.json({ error: "INTERNAL", message: "服务暂时不可用" }, { status: 500 });
    return NextResponse.json(serializeTemplate(row), { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
