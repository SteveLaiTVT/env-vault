import { NextResponse } from "next/server";
import { writeSessionCookie } from "../../../../server/guard";
import { requireDb } from "../../../../server/guard";
import { toErrorResponse } from "../../../../server/http";
import { readJson, registerSchema } from "../../../../server/schemas";
import { createSession, registerUser } from "../../../../server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const got = await requireDb();
    if ("error" in got) return got.error;
    const body = await readJson(req, registerSchema);
    const userId = await registerUser(got.db, body);
    const token = await createSession(got.db, userId);
    await writeSessionCookie(token);
    return NextResponse.json({ ok: true, email: body.email.trim().toLowerCase() }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
