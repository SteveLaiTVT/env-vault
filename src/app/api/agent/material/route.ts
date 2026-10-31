import { NextResponse } from "next/server";
import { requireDb } from "../../../../server/guard";
import { toErrorResponse } from "../../../../server/http";
import { agentSchema, readJson } from "../../../../server/schemas";
import { agentMaterial } from "../../../../server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const got = await requireDb();
    if ("error" in got) return got.error;
    const body = await readJson(req, agentSchema);
    const material = await agentMaterial(got.db, body);
    return NextResponse.json(material);
  } catch (err) {
    return toErrorResponse(err);
  }
}
