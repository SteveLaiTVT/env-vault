import { forbiddenPlaintext } from "../../../../server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return forbiddenPlaintext();
}

export function POST() {
  return forbiddenPlaintext();
}
