import type { OutputFormat } from "./types";

export type Kv = { key: string; value: string };

function dotenvQuote(value: string): string {
  if (value === "") return '""';
  if (/[\s#"'=\\]/.test(value) || value !== value.trim()) {
    const escaped = value
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"')
      .replaceAll("\n", "\\n")
      .replaceAll("\r", "\\r");
    return `"${escaped}"`;
  }
  return value;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function fishQuote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function powershellQuote(value: string): string {
  const escaped = value
    .replaceAll("`", "``")
    .replaceAll('"', '`"')
    .replaceAll("$", "`$")
    .replaceAll("\r", "`r")
    .replaceAll("\n", "`n");
  return `"${escaped}"`;
}

function cmdQuote(value: string): string {
  return value.replaceAll("%", "%%").replaceAll('"', '""');
}

function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

export function renderFormat(format: OutputFormat, entries: Kv[]): string {
  if (format === "dotenv") {
    return entries.map((e) => `${e.key}=${dotenvQuote(e.value)}`).join("\n") + (entries.length ? "\n" : "");
  }
  if (format === "shell" || format === "bash") {
    return entries.map((e) => `export ${e.key}=${shellQuote(e.value)}`).join("\n") + (entries.length ? "\n" : "");
  }
  if (format === "fish") {
    return entries.map((e) => `set -gx ${e.key} ${fishQuote(e.value)}`).join("\n") + (entries.length ? "\n" : "");
  }
  if (format === "powershell") {
    return entries.map((e) => `$env:${e.key} = ${powershellQuote(e.value)}`).join("\n") + (entries.length ? "\n" : "");
  }
  if (format === "cmd") {
    return entries.map((e) => `set "${e.key}=${cmdQuote(e.value)}"`).join("\n") + (entries.length ? "\n" : "");
  }
  if (format === "json") {
    const obj: Record<string, string> = {};
    for (const e of entries) obj[e.key] = e.value;
    return JSON.stringify(obj, null, 2) + "\n";
  }
  if (format === "yaml") {
    return entries.map((e) => `${e.key}: ${yamlQuote(e.value)}`).join("\n") + (entries.length ? "\n" : "");
  }
  const body = entries.map((e) => `        ${e.key}: ${yamlQuote(e.value)}`).join("\n");
  return `services:\n  app:\n    environment:\n${body}${body ? "\n" : ""}`;
}

export function fileNameFor(format: OutputFormat): string {
  if (format === "dotenv") return ".env";
  if (format === "json") return "env.json";
  if (format === "yaml") return "env.yaml";
  if (format === "compose") return "compose.snippet.yml";
  if (format === "fish") return "env.fish";
  if (format === "powershell") return "env.ps1";
  if (format === "cmd") return "env.cmd";
  return "env.sh";
}

const PLACEHOLDER = /\{\{vault:([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

export function fillTemplate(
  template: string,
  values: Record<string, string>,
  opts?: { base64?: boolean },
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = template.replace(PLACEHOLDER, (_all, key: string) => {
    if (!(key in values)) {
      missing.add(key);
      return `{{vault:${key}}}`;
    }
    const raw = values[key] ?? "";
    if (opts?.base64) return bytesToStdB64(new TextEncoder().encode(raw));
    return raw;
  });
  return { text, missing: [...missing] };
}

function bytesToStdB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function extractPlaceholders(template: string): string[] {
  const keys = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    if (match[1]) keys.add(match[1]);
  }
  return [...keys];
}

export type BuiltinId = "gha" | "k8s" | "systemd";

export function builtinTemplate(id: BuiltinId, keys: string[]): { title: string; body: string; base64: boolean; ext: string } {
  if (id === "gha") {
    const lines = keys.map((k) => `  ${k}: "{{vault:${k}}}"`);
    return { title: "GitHub Actions", body: `env:\n${lines.join("\n")}\n`, base64: false, ext: "gha.yml" };
  }
  if (id === "k8s") {
    const lines = keys.map((k) => `  ${k}: "{{vault:${k}}}"`);
    return {
      title: "Kubernetes Secret",
      body: `apiVersion: v1\nkind: Secret\nmetadata:\n  name: env-vault\ntype: Opaque\ndata:\n${lines.join("\n")}\n`,
      base64: true,
      ext: "secret.yml",
    };
  }
  const lines = keys.map((k) => `${k}={{vault:${k}}}`);
  return { title: "systemd EnvironmentFile", body: `${lines.join("\n")}\n`, base64: false, ext: "app.env" };
}

export const BUILTIN_LIST: { id: BuiltinId; title: string }[] = [
  { id: "gha", title: "GitHub Actions" },
  { id: "k8s", title: "Kubernetes Secret" },
  { id: "systemd", title: "systemd EnvironmentFile" },
];
