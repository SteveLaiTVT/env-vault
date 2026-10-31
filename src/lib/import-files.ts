import { parseDotenv } from "./dotenv";
import { KEY_RE, type ScopeType } from "./types";

export const IMPORT_LIMIT = 500;

export type ParsedImport = {
  rows: { key: string; value: string; line: number }[];
  errors: { line: number; error: string }[];
};

export function parseImportFile(filename: string, text: string): ParsedImport {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".env")) return normalizeDotenv(parseDotenv(text));
  if (lower.endsWith(".json")) return parseFlatJson(text);
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return parseFlatYaml(text);
  return { rows: [], errors: [{ line: 1, error: "只支持 .env、.json、.yaml、.yml" }] };
}

function normalizeDotenv(parsed: ReturnType<typeof parseDotenv>): ParsedImport {
  return {
    rows: parsed.rows,
    errors: parsed.errors.map((item) => ({ line: item.line, error: item.error ?? "无法解析" })),
  };
}

function parseFlatJson(text: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { rows: [], errors: [{ line: 1, error: "JSON 无法解析" }] };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { rows: [], errors: [{ line: 1, error: "JSON 必须是扁平对象" }] };
  }
  const rows: ParsedImport["rows"] = [];
  const errors: ParsedImport["errors"] = [];
  for (const [key, value] of Object.entries(data)) {
    const line = lineOfKey(text, key);
    if (!KEY_RE.test(key)) {
      errors.push({ line, error: "key 不合法" });
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      rows.push({ key, value: String(value), line });
      continue;
    }
    errors.push({ line, error: "不是扁平值" });
  }
  return { rows, errors };
}

function parseFlatYaml(text: string): ParsedImport {
  const rows: ParsedImport["rows"] = [];
  const errors: ParsedImport["errors"] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = i + 1;
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (/^\s/.test(raw)) {
      errors.push({ line, error: "不支持嵌套" });
      continue;
    }
    const match = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!match) {
      errors.push({ line, error: "不是扁平的 KEY: value" });
      continue;
    }
    const key = match[1] ?? "";
    let value = (match[2] ?? "").trim();
    if (!value) {
      rows.push({ key, value: "", line });
      continue;
    }
    if (/^[{[\|>]/.test(value)) {
      errors.push({ line, error: "不是扁平值" });
      continue;
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    rows.push({ key, value, line });
  }
  return { rows, errors };
}

function lineOfKey(text: string, key: string): number {
  const lines = text.split(/\r?\n/);
  const found = lines.findIndex((line) => line.includes(`"${key}"`) || line.includes(`'${key}'`));
  return found >= 0 ? found + 1 : 1;
}

export type ImportTarget = { scopeType: ScopeType; scopeId: string | null };

export type ImportOutcome = {
  added: number;
  overwritten: number;
  failed: number;
  blocked: boolean;
};

export function summarizeImport(
  existing: { scopeType: ScopeType; scopeId: string | null; key: string }[],
  batches: { target: ImportTarget; rows: { key: string }[]; errorCount: number }[],
): ImportOutcome {
  const valid = batches.reduce((sum, batch) => sum + batch.rows.filter((row) => KEY_RE.test(row.key)).length, 0);
  const failed = batches.reduce((sum, batch) => sum + batch.errorCount + batch.rows.filter((row) => !KEY_RE.test(row.key)).length, 0);
  if (valid > IMPORT_LIMIT) return { added: 0, overwritten: 0, failed, blocked: true };
  const seen = new Set(existing.map((row) => identity(row.scopeType, row.scopeId, row.key)));
  let added = 0;
  let overwritten = 0;
  for (const batch of batches) {
    for (const row of batch.rows) {
      if (!KEY_RE.test(row.key)) continue;
      const id = identity(batch.target.scopeType, batch.target.scopeId, row.key);
      if (seen.has(id)) overwritten += 1;
      else {
        added += 1;
        seen.add(id);
      }
    }
  }
  return { added, overwritten, failed, blocked: false };
}

function identity(scopeType: ScopeType, scopeId: string | null, key: string): string {
  return `${scopeType}\u0000${scopeId ?? ""}\u0000${key}`;
}

export function undoImportBatch<T extends { id: string; key: string; scopeType: ScopeType; scopeId: string | null }>(
  current: T[],
  batch: { id: string; prev: T | null }[],
): T[] {
  let next = [...current];
  for (const item of [...batch].reverse()) {
    if (!item.prev) {
      next = next.filter((row) => row.id !== item.id);
      continue;
    }
    const prev = item.prev;
    next = next.filter((row) => row.id !== prev.id && !(row.scopeType === prev.scopeType && row.scopeId === prev.scopeId && row.key === prev.key));
    next.push(prev);
  }
  return next;
}
