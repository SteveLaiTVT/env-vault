import { NextResponse } from "next/server";
import { requireUser } from "../../../server/guard";
import { toErrorResponse } from "../../../server/http";
import { readJson, tokenSchema } from "../../../server/schemas";
import { createToken, listTokens } from "../../../server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    return NextResponse.json({ items: await listTokens(ctx.db, ctx.user.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const body = await readJson(req, tokenSchema);
    const created = await createToken(ctx.db, ctx.user.id, body);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
