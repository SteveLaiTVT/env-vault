import { NextResponse } from "next/server";
import { requireUser } from "../../../server/guard";
import { toErrorResponse } from "../../../server/http";
import { auditSchema, readJson } from "../../../server/schemas";
import { listAudit, writeAudit } from "../../../server/service";
import { serializeAudit } from "../../../server/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const offset = Number(new URL(req.url).searchParams.get("offset") ?? "0");
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.min(offset, 5000) : 0;
    const rows = await listAudit(ctx.db, ctx.user.id, safeOffset);
    return NextResponse.json({ items: rows.map(serializeAudit) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const body = await readJson(req, auditSchema);
    await writeAudit(ctx.db, ctx.user.id, { ...body, result: body.result ?? "ok" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
