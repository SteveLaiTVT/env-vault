import type { ScopeType, VarType } from "./types";

export type BackupVariable = {
  scopeType: ScopeType;
  scopeName: string;
  key: string;
  type: VarType;
  value: string;
  note: string;
  updatedAt: string;
};

export function migrationCounts(
  localRows: BackupVariable[],
  cloudRows: BackupVariable[],
): { added: number; overwritten: number; unchanged: number } {
  const cloud = new Map(cloudRows.map((row) => [identity(row), row.value]));
  let added = 0;
  let overwritten = 0;
  let unchanged = 0;
  for (const row of localRows) {
    const prev = cloud.get(identity(row));
    if (prev === undefined) added += 1;
    else if (prev !== row.value) overwritten += 1;
    else unchanged += 1;
  }
  return { added, overwritten, unchanged };
}

function identity(row: BackupVariable): string {
  return `${row.scopeType}\u0000${row.scopeName}\u0000${row.key}`;
}

export type BackupFile = {
  format: "env-vault-backup";
  version: 1;
  exportedAt: string;
  kdf: { salt: string; memory: number; iterations: number; parallelism: number };
  wrappedDek: string;
  dekIv: string;
  servers: { name: string; note: string }[];
  projects: { name: string; note: string; serverNames: string[] }[];
  variables: {
    scopeType: ScopeType;
    scopeName: string;
    key: string;
    type: VarType;
    valueCipher: string;
    valueIv: string;
    noteCipher: string | null;
    noteIv: string | null;
    updatedAt: string;
  }[];
  templates: { name: string; bodyCipher: string; bodyIv: string }[];
};

export function parseBackup(input: unknown): BackupFile {
  if (!input || typeof input !== "object") throw new Error("备份文件无法解析");
  const file = input as Partial<BackupFile>;
  if (file.format !== "env-vault-backup" || file.version !== 1) throw new Error("不认识的备份版本");
  if (!file.kdf || !file.wrappedDek || !file.dekIv) throw new Error("备份缺少密钥包装");
  if (!Array.isArray(file.servers) || !Array.isArray(file.projects) || !Array.isArray(file.variables)) {
    throw new Error("备份结构不完整");
  }
  return file as BackupFile;
}
