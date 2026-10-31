import { NextResponse } from "next/server";
import { requireUser } from "../../../server/guard";
import { toErrorResponse } from "../../../server/http";
import { projectSchema, readJson } from "../../../server/schemas";
import { createProject } from "../../../server/service";
import { serializeProject } from "../../../server/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const body = await readJson(req, projectSchema);
    const row = await createProject(ctx.db, ctx.user.id, body.name, body.note ?? "", body.serverIds ?? []);
    return NextResponse.json({ ...serializeProject(row), serverIds: body.serverIds }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
