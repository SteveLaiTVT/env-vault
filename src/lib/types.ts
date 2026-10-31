export type ScopeType = "public" | "server" | "project";
export type VarType = "secret" | "plain";
export type OutputFormat = "dotenv" | "bash" | "fish" | "powershell" | "cmd" | "json" | "yaml" | "compose" | "shell";
export type ShellKind = "bash" | "zsh" | "fish" | "powershell" | "cmd";

export type KdfParams = {
  memory: number;
  iterations: number;
  parallelism: number;
};

export const PROD_KDF: KdfParams = {
  memory: 19456,
  iterations: 2,
  parallelism: 1,
};

export const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const MAX_VALUE_BYTES = 64 * 1024;
export const MAX_NOTE_CHARS = 2000;
export const TOKEN_MAX_MS = 90 * 24 * 60 * 60 * 1000;
export const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
export const AUDIT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
export const VERSION_KEEP = 10;

export type VarRef = {
  id: string;
  key: string;
  scopeType: ScopeType;
  scopeId: string | null;
  type: VarType;
  value: string;
  note: string;
  updatedAt: string;
};

export type ViewSelection =
  | { type: "public" }
  | { type: "server"; serverId: string }
  | { type: "project"; projectId: string };

export type CipherBlob = {
  cipher: string;
  iv: string;
};
