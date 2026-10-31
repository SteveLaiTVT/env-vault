export type ParsedLine = {
  line: number;
  key?: string;
  value?: string;
  error?: string;
};

export function parseDotenv(text: string): { rows: { key: string; value: string; line: number }[]; errors: ParsedLine[] } {
  const rows: { key: string; value: string; line: number }[] = [];
  const errors: ParsedLine[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const lineNo = i + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    let body = trimmed;
    if (body.startsWith("export ")) body = body.slice(7).trim();
    const eq = body.indexOf("=");
    if (eq <= 0) {
      errors.push({ line: lineNo, error: "缺少 KEY=VALUE" });
      continue;
    }
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      errors.push({ line: lineNo, error: "key 不合法" });
      continue;
    }
    let value = body.slice(eq + 1);
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      if (!value.endsWith(quote) || value.length < 2) {
        errors.push({ line: lineNo, error: "引号未闭合，不支持无引号跨行值" });
        continue;
      }
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    } else {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash);
      value = value.trim();
    }
    rows.push({ key, value, line: lineNo });
  }
  return { rows, errors };
}
