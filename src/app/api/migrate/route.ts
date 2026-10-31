import { NextResponse } from "next/server";
import { requireUser } from "../../../server/guard";
import { toErrorResponse } from "../../../server/http";
import { migrateSchema, readJson } from "../../../server/schemas";
import { migrateVault } from "../../../server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const body = await readJson(req, migrateSchema);
    const result = await migrateVault(ctx.db, ctx.user.id, { ...body, templates: body.templates ?? [] });
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
