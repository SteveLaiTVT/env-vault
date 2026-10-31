import { NextResponse } from "next/server";
import { requireDb, sessionTokenHash } from "../../../../server/guard";
import { toErrorResponse } from "../../../../server/http";
import { publicAccount, userFromTokenHash } from "../../../../server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const got = await requireDb();
    if ("error" in got) return got.error;
    const hash = await sessionTokenHash();
    if (!hash) return NextResponse.json({ authenticated: false });
    const user = await userFromTokenHash(got.db, hash);
    if (!user) return NextResponse.json({ authenticated: false });
    return NextResponse.json({ authenticated: true, ...publicAccount(user) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
