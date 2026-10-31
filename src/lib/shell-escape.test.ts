import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { renderFormat } from "./format";

const samples = [
  ["space", "hello world"],
  ["single", "a'b"],
  ["double", 'say "hi"'],
  ["dollar", "price $5"],
  ["backtick", "tick ` here"],
  ["newline", "line1\nline2"],
  ["chinese", "中文密钥"],
] as const;

function statement(format: "bash" | "fish" | "powershell" | "cmd", key: string, value: string): string {
  return renderFormat(format, [{ key, value }]).trimEnd();
}

function posixUnquote(quoted: string): string {
  expect(quoted.startsWith("'")).toBe(true);
  expect(quoted.endsWith("'")).toBe(true);
  return quoted.slice(1, -1).replaceAll("'\\''", "'");
}

function fishUnquote(quoted: string): string {
  expect(quoted.startsWith("'")).toBe(true);
  expect(quoted.endsWith("'")).toBe(true);
  const inner = quoted.slice(1, -1);
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\" && i + 1 < inner.length) {
      out += inner[i + 1];
      i += 1;
      continue;
    }
    out += inner[i];
  }
  return out;
}

function powershellUnquote(quoted: string): string {
  expect(quoted.startsWith('"')).toBe(true);
  expect(quoted.endsWith('"')).toBe(true);
  const inner = quoted.slice(1, -1);
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "`" && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (next === "n") out += "\n";
      else if (next === "r") out += "\r";
      else out += next;
      i += 1;
      continue;
    }
    out += inner[i];
  }
  return out;
}

function cmdUnquote(line: string, key: string): string {
  const prefix = `set "${key}=`;
  expect(line.startsWith(prefix)).toBe(true);
  expect(line.endsWith('"')).toBe(true);
  return line.slice(prefix.length, -1).replaceAll('""', '"').replaceAll("%%", "%");
}

describe("shell escaping round-trip", () => {
  it("restores bash and zsh values from POSIX single quotes", () => {
    for (const [, value] of samples) {
      const line = statement("bash", "KEY", value);
      expect(line.startsWith("export KEY=")).toBe(true);
      expect(posixUnquote(line.slice("export KEY=".length))).toBe(value);
      expect(renderFormat("shell", [{ key: "KEY", value }])).toBe(`${line}\n`);
    }
  });

  it("restores fish values after backslash and quote escapes", () => {
    for (const [, value] of samples) {
      const line = statement("fish", "KEY", value);
      expect(line.startsWith("set -gx KEY ")).toBe(true);
      expect(fishUnquote(line.slice("set -gx KEY ".length))).toBe(value);
    }
  });

  it("restores PowerShell values after dollar, backtick, and quote escapes", () => {
    for (const [, value] of samples) {
      const line = statement("powershell", "KEY", value);
      expect(line.startsWith("$env:KEY = ")).toBe(true);
      expect(powershellUnquote(line.slice("$env:KEY = ".length))).toBe(value);
    }
  });

  it("restores cmd values after percent and quote encoding", () => {
    for (const [, value] of samples) {
      const line = statement("cmd", "KEY", value);
      expect(cmdUnquote(line, "KEY")).toBe(value);
    }
    expect(statement("cmd", "KEY", "100%")).toBe('set "KEY=100%%"');
    expect(statement("cmd", "KEY", 'say "hi"')).toBe('set "KEY=say ""hi"""');
  });

  it("bash eval restores a mixed value when bash is available", () => {
    const value = "hello world a'b \"c\" $5 `tick`\n中文";
    const script = `${statement("bash", "KEY", value)}\nprintf %s "$KEY"`;
    const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
    if (result.error) return;
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(value);
  });
});
