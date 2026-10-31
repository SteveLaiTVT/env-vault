import { NextResponse } from "next/server";
import { requireUser } from "../../../server/guard";
import { iso, toErrorResponse } from "../../../server/http";
import { bootstrap } from "../../../server/service";
import { serializeProject, serializeServer, serializeTemplate, serializeVariable, serializeVersion } from "../../../server/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const data = await bootstrap(ctx.db, ctx.user.id);
    return NextResponse.json({
      servers: data.servers.map(serializeServer),
      projects: data.projects.map(serializeProject),
      links: data.links.map((link) => ({ projectId: link.projectId, serverId: link.serverId, sortOrder: link.sortOrder })),
      variables: data.variables.map(serializeVariable),
      versions: data.versions.map(serializeVersion),
      templates: data.templates.map(serializeTemplate),
      wrappedDek: ctx.user.wrappedDek,
      dekIv: ctx.user.dekIv,
      fetchedAt: iso(new Date()),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
