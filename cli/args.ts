import type { ShellKind } from "../src/lib/types";

export type RenderArgs = {
  cmd: "render";
  token: string;
  api: string;
  templatePath: string;
  outPath: string;
};

export type RunArgs = {
  cmd: "run";
  token: string;
  api: string;
  command: string[];
};

export type ShellArgs = {
  cmd: "shell";
  token: string;
  api: string;
  shell: ShellKind;
};

export type CliArgs = RenderArgs | RunArgs | ShellArgs;

const USAGE = "用法: env-vault render --template 文件 --out 文件 | env-vault run -- 命令 | env-vault shell [--shell bash|zsh|fish|powershell|cmd]";

export function detectShell(env: Record<string, string | undefined>): ShellKind {
  const shell = env.SHELL ?? "";
  if (shell) {
    const base = shell.split(/[/\\]/).pop()?.toLowerCase() ?? "";
    if (base.includes("zsh")) return "zsh";
    if (base.includes("fish")) return "fish";
    if (base.includes("pwsh") || base.includes("powershell")) return "powershell";
    if (base.includes("cmd")) return "cmd";
    if (base.includes("bash")) return "bash";
  }
  if (env.PSModulePath) return "powershell";
  if (env.ComSpec) return "cmd";
  return "bash";
}

export function parseShellKind(value: string): ShellKind {
  if (value === "bash" || value === "zsh" || value === "fish" || value === "powershell" || value === "cmd") return value;
  throw new Error("无法识别的 shell");
}

export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env): CliArgs {
  const args = [...argv];
  const cmd = args.shift();
  if (cmd !== "render" && cmd !== "run" && cmd !== "shell") {
    throw new Error(USAGE);
  }
  let token = env.ENV_VAULT_TOKEN ?? "";
  let api = env.ENV_VAULT_API ?? "http://localhost:3000";
  let templatePath = "";
  let outPath = "";
  let shell = detectShell(env);
  const command: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      command.push(...args.slice(i + 1));
      break;
    }
    if (arg === "--token") token = args[++i] ?? "";
    else if (arg === "--api") api = args[++i] ?? "";
    else if (arg === "--template") templatePath = args[++i] ?? "";
    else if (arg === "--out") outPath = args[++i] ?? "";
    else if (arg === "--shell") shell = parseShellKind(args[++i] ?? "");
    else throw new Error("无法识别的参数");
  }
  if (!token) throw new Error("缺少令牌。使用 --token 或 ENV_VAULT_TOKEN");
  if (!api) throw new Error("缺少 API 地址");
  if (cmd === "render") {
    if (!templatePath || !outPath) throw new Error("render 需要 --template 和 --out");
    return { cmd, token, api, templatePath, outPath };
  }
  if (cmd === "shell") return { cmd, token, api, shell };
  if (command.length === 0) throw new Error("run 需要 -- 后面的命令");
  return { cmd, token, api, command };
}
