import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "../../../../server/guard";
import { toErrorResponse } from "../../../../server/http";
import { readJson } from "../../../../server/schemas";
import { transferVariables } from "../../../../server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  targetScopeType: z.enum(["public", "server", "project"]),
  targetServerId: z.string().uuid().nullable().optional(),
  targetProjectId: z.string().uuid().nullable().optional(),
  mode: z.enum(["move", "copy"]),
  conflict: z.enum(["skip", "overwrite", "keep"]),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const body = await readJson(req, schema);
    const counts = await transferVariables(ctx.db, ctx.user.id, body);
    return NextResponse.json(counts);
  } catch (err) {
    return toErrorResponse(err);
  }
}
