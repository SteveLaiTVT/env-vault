import { TOKEN_MAX_MS } from "./types";

export type TokenOp = "inject" | "replace";

export type TokenPolicy = {
  canInject: boolean;
  canReplace: boolean;
  expiresAt: string;
  revokedAt: string | null;
};

export class PolicyError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 403) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function assertTokenOp(token: TokenPolicy, op: TokenOp, now = new Date()): void {
  if (token.revokedAt) throw new PolicyError("REVOKED", "令牌已吊销");
  if (new Date(token.expiresAt).getTime() <= now.getTime()) throw new PolicyError("EXPIRED", "令牌已过期");
  if (op === "inject" && !token.canInject) throw new PolicyError("FORBIDDEN_OP", "令牌没有注入权限");
  if (op === "replace" && !token.canReplace) throw new PolicyError("FORBIDDEN_OP", "令牌没有替换权限");
}

export function assertExpiryWindow(expiresAt: Date, now = new Date()): void {
  if (Number.isNaN(expiresAt.getTime())) throw new PolicyError("BAD_EXPIRY", "过期时间不合法", 400);
  if (expiresAt.getTime() <= now.getTime()) throw new PolicyError("BAD_EXPIRY", "过期时间必须晚于现在", 400);
  if (expiresAt.getTime() - now.getTime() > TOKEN_MAX_MS) {
    throw new PolicyError("BAD_EXPIRY", "过期时间最长 90 天", 400);
  }
}

export const PLAINTEXT_ERROR = {
  error: "PLAINTEXT_FORBIDDEN",
  message: "不存在返回明文的接口。人工导出只能在已登录浏览器内解密后进行。",
} as const;

export function plaintextForbiddenResponse(): { status: 403; body: typeof PLAINTEXT_ERROR } {
  return { status: 403, body: PLAINTEXT_ERROR };
}

const MATERIAL_KEYS = new Set([
  "op",
  "scopeType",
  "scopeId",
  "wrappedDek",
  "publicKeySpki",
  "serverOrder",
  "variables",
  "id",
  "key",
  "scopeName",
  "type",
  "valueCipher",
  "valueIv",
  "noteCipher",
  "noteIv",
  "updatedAt",
]);

export type AgentVariableCipher = {
  id: string;
  key: string;
  scopeType: "public" | "server" | "project";
  scopeId: string | null;
  scopeName: string;
  type: "secret" | "plain";
  valueCipher: string;
  valueIv: string;
  noteCipher: string | null;
  noteIv: string | null;
  updatedAt: string;
};

export type AgentMaterial = {
  op: TokenOp;
  scopeType: "public" | "server" | "project";
  scopeId: string | null;
  wrappedDek: string;
  publicKeySpki: string;
  serverOrder: string[];
  variables: AgentVariableCipher[];
};

export function buildAgentMaterial(input: AgentMaterial): AgentMaterial {
  const variables = input.variables.map((row) => ({
    id: row.id,
    key: row.key,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    scopeName: row.scopeName,
    type: row.type,
    valueCipher: row.valueCipher,
    valueIv: row.valueIv,
    noteCipher: row.noteCipher,
    noteIv: row.noteIv,
    updatedAt: row.updatedAt,
  }));
  const material: AgentMaterial = {
    op: input.op,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    wrappedDek: input.wrappedDek,
    publicKeySpki: input.publicKeySpki,
    serverOrder: input.serverOrder,
    variables,
  };
  assertWhitelisted(material);
  return material;
}

function assertWhitelisted(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertWhitelisted(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (!MATERIAL_KEYS.has(key)) {
      throw new PolicyError("PLAINTEXT_LEAK", "响应包含非白名单字段", 500);
    }
    assertWhitelisted((value as Record<string, unknown>)[key]);
  }
}

const META_KEYS = new Set(["format", "count", "missingKeys", "keys", "op", "reason", "imported", "overwritten", "added", "failed", "moved", "copied", "skipped", "kept", "mode", "source", "target"]);

export function sanitizeAuditMeta(input: unknown): Record<string, string | number | string[]> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string | number | string[]> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!META_KEYS.has(key)) continue;
    if ((key === "missingKeys" || key === "keys") && Array.isArray(value) && value.every((v) => typeof v === "string")) {
      out[key] = value.slice(0, 200);
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    if (typeof value === "string" && value.length <= 80 && !value.includes("=")) {
      out[key] = value;
    }
  }
  return out;
}
