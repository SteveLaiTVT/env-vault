import { NextResponse } from "next/server";
import { requireUser } from "../../../server/guard";
import { toErrorResponse } from "../../../server/http";
import { nameSchema, readJson } from "../../../server/schemas";
import { createServer } from "../../../server/service";
import { serializeServer } from "../../../server/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const body = await readJson(req, nameSchema);
    const row = await createServer(ctx.db, ctx.user.id, body.name, body.note ?? "");
    return NextResponse.json(serializeServer(row), { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
