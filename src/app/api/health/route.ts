import { NextResponse } from "next/server";
import { databaseUrl } from "../../../server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, cloud: Boolean(databaseUrl()) });
}
