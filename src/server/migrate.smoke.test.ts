import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const tsx = path.resolve("node_modules/.bin/tsx");

function runTsx(entry: string, env: Record<string, string | undefined>) {
  return spawnSync(tsx, [entry], {
    encoding: "utf8",
    cwd: process.cwd(),
    env: { ...process.env, ...env },
  });
}

function outputOf(result: ReturnType<typeof runTsx>): string {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function databaseUrlFromLocalEnv(): string | undefined {
  try {
    const text = readFileSync(".env.local", "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("DATABASE_URL=")) return trimmed.slice("DATABASE_URL=".length).trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

describe("tsx entrypoints", () => {
  it("runs the migrate script under tsx CJS instead of failing to transform", () => {
    const result = runTsx("src/server/migrate.ts", { DATABASE_URL: "" });
    const output = outputOf(result);
    expect(output).not.toMatch(/Transform failed|Top-level await/);
    expect(output).toContain("缺少 DATABASE_URL");
    expect(result.status).toBe(1);
  });

  it("runs the cli entry under tsx without a transform failure", () => {
    const result = runTsx("cli/index.ts", {});
    const output = outputOf(result);
    expect(output).not.toMatch(/Transform failed|Top-level await/);
    expect(output).toContain("用法");
    expect(result.status).toBe(1);
  });

  it("applies the schema when a local database url is present", async () => {
    const url = databaseUrlFromLocalEnv();
    if (!url) return;
    const result = runTsx("src/server/migrate.ts", { DATABASE_URL: url });
    const output = outputOf(result);
    expect(output).not.toMatch(/Transform failed|Top-level await/);
    expect(result.status).toBe(0);
    expect(output).toContain("迁移完成");

    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      const tables = await client.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public'",
      );
      const names = tables.rows.map((row) => row.table_name);
      for (const name of ["users", "sessions", "servers", "projects", "project_servers", "variables", "variable_versions", "audit_logs", "machine_tokens", "templates"]) {
        expect(names).toContain(name);
      }
    } finally {
      await client.end();
    }
  });
});
