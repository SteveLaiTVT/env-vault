import { NextResponse } from "next/server";
import { requireDb } from "../../../../server/guard";
import { toErrorResponse } from "../../../../server/http";
import { emailSchema, readJson } from "../../../../server/schemas";
import { prelogin } from "../../../../server/service";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const got = await requireDb();
    if ("error" in got) return got.error;
    const body = await readJson(req, z.object({ email: emailSchema }));
    return NextResponse.json(await prelogin(got.db, body.email));
  } catch (err) {
    return toErrorResponse(err);
  }
}
