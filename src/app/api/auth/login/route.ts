import { NextResponse } from "next/server";
import { requireDb, writeSessionCookie } from "../../../../server/guard";
import { toErrorResponse } from "../../../../server/http";
import { loginSchema, readJson } from "../../../../server/schemas";
import { createSession, loginUser, publicAccount } from "../../../../server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const got = await requireDb();
    if ("error" in got) return got.error;
    const body = await readJson(req, loginSchema);
    const user = await loginUser(got.db, body.email, body.authKey);
    const token = await createSession(got.db, user.id);
    await writeSessionCookie(token);
    return NextResponse.json({ ok: true, ...publicAccount(user) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
