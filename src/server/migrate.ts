import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

function migrationSqlPath(): string {
  return path.resolve(__dirname, "../../drizzle/0000_init.sql");
}

export async function runMigration(databaseUrl: string, sqlPath = migrationSqlPath()): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(readFileSync(sqlPath, "utf8"));
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("缺少 DATABASE_URL");
    process.exit(1);
  }
  await runMigration(url);
  console.log("迁移完成");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "迁移失败";
  console.error(message.includes("postgres://") || message.includes("password=") ? "迁移失败" : message);
  process.exit(1);
});
