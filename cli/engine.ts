import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { aesDecrypt, parseTokenString, rsaUnwrapDek } from "../src/lib/crypto";
import { fillTemplate } from "../src/lib/format";
import { activeEntries, mergeEffective } from "../src/lib/merge";
import { decryptOptional } from "../src/lib/crypto";
import { redactOutput } from "../src/lib/redact";
import type { AgentMaterial } from "../src/lib/token-policy";
import type { VarRef } from "../src/lib/types";

export async function loadMaterial(api: string, token: string, op: "inject" | "replace"): Promise<AgentMaterial> {
  const parsed = parseTokenString(token);
  if (!parsed) throw new Error("令牌格式不正确");
  const res = await fetch(`${api.replace(/\/$/, "")}/api/agent/material`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicId: parsed.publicId, authSecret: parsed.authSecret, op }),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!res.ok) throw new Error(data.message || "令牌请求失败");
  return data as AgentMaterial;
}

export async function decryptMaterial(token: string, material: AgentMaterial): Promise<VarRef[]> {
  const parsed = parseTokenString(token);
  if (!parsed) throw new Error("令牌格式不正确");
  const dek = await rsaUnwrapDek(parsed.pkcs8, material.wrappedDek);
  const rows: VarRef[] = [];
  for (const row of material.variables) {
    rows.push({
      id: row.id,
      key: row.key,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      type: row.type,
      value: await aesDecrypt(dek, row.valueCipher, row.valueIv),
      note: await decryptOptional(dek, row.noteCipher, row.noteIv),
      updatedAt: row.updatedAt,
    });
  }
  const view = material.scopeType === "public"
    ? { type: "public" as const }
    : material.scopeType === "server"
      ? { type: "server" as const, serverId: material.scopeId ?? "" }
      : { type: "project" as const, projectId: material.scopeId ?? "" };
  return activeEntries(mergeEffective(rows, view, material.serverOrder));
}

export function renderTemplateText(template: string, rows: VarRef[], base64 = false) {
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return fillTemplate(template, map, { base64 });
}

export async function renderToFile(templatePath: string, outPath: string, rows: VarRef[]) {
  const template = readFileSync(templatePath, "utf8");
  const filled = renderTemplateText(template, rows, template.includes("kind: Secret"));
  if (filled.missing.length) {
    return { ok: false as const, missing: filled.missing };
  }
  writeFileSync(outPath, filled.text, { mode: 0o600 });
  return { ok: true as const, missing: [] as string[] };
}

export async function runWithEnv(command: string[], rows: VarRef[]) {
  const injected: Record<string, string> = {};
  for (const row of rows) injected[row.key] = row.value;
  const child = spawn(command[0] ?? "", command.slice(1), {
    env: { ...process.env, ...injected },
    stdio: ["inherit", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const code = await new Promise<number>((resolve) => {
    child.on("close", (status) => resolve(status ?? 1));
  });
  const items = rows.map((row) => ({ value: row.value, type: row.type }));
  process.stdout.write(redactOutput(Buffer.concat(stdout).toString("utf8"), items));
  process.stderr.write(redactOutput(Buffer.concat(stderr).toString("utf8"), items));
  return code;
}
