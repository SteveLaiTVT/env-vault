import { NextResponse } from "next/server";
import { clearSessionCookie, requireDb, sessionTokenHash } from "../../../../server/guard";
import { toErrorResponse } from "../../../../server/http";
import { deleteSession } from "../../../../server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const got = await requireDb();
    if ("error" in got) return got.error;
    const hash = await sessionTokenHash();
    if (hash) await deleteSession(got.db, hash);
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
