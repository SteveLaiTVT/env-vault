import { and, desc, eq, lt } from "drizzle-orm";
import { sha256Hex, timingSafeEqualHex } from "../lib/bytes";
import { hashAuthKey, newKdfSalt } from "../lib/crypto";
import { buildAgentMaterial, sanitizeAuditMeta, assertTokenOp, assertExpiryWindow, type TokenOp } from "../lib/token-policy";
import { planTransfer, type ConflictPolicy, type TransferMode } from "../lib/transfer";
import { AUDIT_RETENTION_MS, KEY_RE, PROD_KDF, SESSION_MS, VERSION_KEEP, type ScopeType, type VarType } from "../lib/types";
import type { AppDb } from "./db";
import {
  auditLogs,
  machineTokens,
  projectServers,
  projects,
  servers,
  sessions,
  templates,
  users,
  variableVersions,
  variables,
} from "./schema";

export class HttpError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type UserRow = typeof users.$inferSelect;

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function publicAccount(user: UserRow) {
  return {
    email: user.email,
    kdfSalt: user.kdfSalt,
    kdfParams: {
      memory: user.kdfMemory,
      iterations: user.kdfIterations,
      parallelism: user.kdfParallelism,
    },
    wrappedDek: user.wrappedDek,
    dekIv: user.dekIv,
  };
}

export async function registerUser(db: AppDb, input: {
  email: string;
  authKey: string;
  kdfSalt: string;
  kdfMemory: number;
  kdfIterations: number;
  kdfParallelism: number;
  wrappedDek: string;
  dekIv: string;
}) {
  const email = input.email.trim().toLowerCase();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) throw new HttpError("CONFLICT", "该邮箱已注册", 409);
  const authSalt = newKdfSalt();
  const authHash = await hashAuthKey(input.authKey, authSalt, PROD_KDF);
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    email,
    kdfSalt: input.kdfSalt,
    kdfMemory: input.kdfMemory,
    kdfIterations: input.kdfIterations,
    kdfParallelism: input.kdfParallelism,
    authSalt,
    authHash,
    wrappedDek: input.wrappedDek,
    dekIv: input.dekIv,
    orgId: null,
  });
  await writeAudit(db, id, { action: "register", result: "ok" });
  return id;
}

export async function loginUser(db: AppDb, emailRaw: string, authKey: string) {
  const email = emailRaw.trim().toLowerCase();
  const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = found[0];
  if (!user) throw new HttpError("UNAUTHORIZED", "邮箱或口令不正确", 401);
  const hash = await hashAuthKey(authKey, user.authSalt, PROD_KDF);
  if (!timingSafeEqualHex(hash, user.authHash)) {
    await writeAudit(db, user.id, { action: "login_fail", result: "fail", meta: { reason: "auth" } });
    throw new HttpError("UNAUTHORIZED", "邮箱或口令不正确", 401);
  }
  await writeAudit(db, user.id, { action: "login_ok", result: "ok" });
  return user;
}

export async function prelogin(db: AppDb, emailRaw: string) {
  const email = emailRaw.trim().toLowerCase();
  const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = found[0];
  if (!user) throw new HttpError("NOT_FOUND", "邮箱未注册", 404);
  return publicAccount(user);
}

export async function createSession(db: AppDb, userId: string): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await sha256Hex(token);
  await db.insert(sessions).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + SESSION_MS),
  });
  return token;
}

export async function userFromTokenHash(db: AppDb, tokenHash: string): Promise<UserRow | null> {
  const found = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  const session = found[0];
  if (!session || asDate(session.expiresAt).getTime() <= Date.now()) return null;
  const rows = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  return rows[0] ?? null;
}

export async function deleteSession(db: AppDb, tokenHash: string) {
  const found = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  const session = found[0];
  if (session) {
    await writeAudit(db, session.userId, { action: "logout", result: "ok" });
    await db.delete(sessions).where(eq(sessions.id, session.id));
  }
}

export async function writeAudit(
  db: AppDb,
  userId: string,
  event: {
    action: string;
    result: string;
    scopeType?: string | null;
    scopeName?: string | null;
    keyName?: string | null;
    tokenId?: string | null;
    meta?: unknown;
  },
) {
  const cutoff = new Date(Date.now() - AUDIT_RETENTION_MS);
  await db.delete(auditLogs).where(and(eq(auditLogs.userId, userId), lt(auditLogs.createdAt, cutoff)));
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    userId,
    action: event.action.slice(0, 40),
    result: event.result.slice(0, 40),
    scopeType: event.scopeType ?? null,
    scopeName: event.scopeName?.slice(0, 80) ?? null,
    keyName: event.keyName?.slice(0, 80) ?? null,
    tokenId: event.tokenId ?? null,
    meta: sanitizeAuditMeta(event.meta),
  });
}

export async function listAudit(db: AppDb, userId: string, offset: number) {
  await db.delete(auditLogs).where(and(eq(auditLogs.userId, userId), lt(auditLogs.createdAt, new Date(Date.now() - AUDIT_RETENTION_MS))));
  return db.select().from(auditLogs).where(eq(auditLogs.userId, userId)).orderBy(desc(auditLogs.createdAt)).limit(100).offset(offset);
}

async function ownedServer(db: AppDb, userId: string, id: string) {
  const rows = await db.select().from(servers).where(and(eq(servers.id, id), eq(servers.userId, userId))).limit(1);
  if (!rows[0]) throw new HttpError("NOT_FOUND", "服务器不存在", 404);
  return rows[0];
}

async function ownedProject(db: AppDb, userId: string, id: string) {
  const rows = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.userId, userId))).limit(1);
  if (!rows[0]) throw new HttpError("NOT_FOUND", "项目不存在", 404);
  return rows[0];
}

export async function createServer(db: AppDb, userId: string, name: string, note: string) {
  const id = crypto.randomUUID();
  try {
    await db.insert(servers).values({ id, userId, name, note, orgId: null });
  } catch {
    throw new HttpError("CONFLICT", "同名服务器已存在", 409);
  }
  await writeAudit(db, userId, { action: "scope_create", result: "ok", scopeType: "server", scopeName: name });
  return (await ownedServer(db, userId, id));
}

export async function updateServer(db: AppDb, userId: string, id: string, patch: { name?: string; note?: string }) {
  const current = await ownedServer(db, userId, id);
  await db.update(servers).set({
    name: patch.name ?? current.name,
    note: patch.note ?? current.note,
    updatedAt: new Date(),
  }).where(eq(servers.id, id));
  await writeAudit(db, userId, { action: "scope_update", result: "ok", scopeType: "server", scopeName: patch.name ?? current.name });
  return ownedServer(db, userId, id);
}

export async function deleteServer(db: AppDb, userId: string, id: string) {
  const current = await ownedServer(db, userId, id);
  await db.delete(variables).where(and(eq(variables.userId, userId), eq(variables.serverId, id)));
  await db.delete(projectServers).where(eq(projectServers.serverId, id));
  await db.delete(machineTokens).where(and(eq(machineTokens.userId, userId), eq(machineTokens.serverId, id)));
  await db.delete(servers).where(eq(servers.id, id));
  await writeAudit(db, userId, { action: "scope_delete", result: "ok", scopeType: "server", scopeName: current.name });
}

export async function createProject(db: AppDb, userId: string, name: string, note: string, serverIds: string[]) {
  await assertServersOwned(db, userId, serverIds);
  const id = crypto.randomUUID();
  try {
    await db.insert(projects).values({ id, userId, name, note, orgId: null });
  } catch {
    throw new HttpError("CONFLICT", "同名项目已存在", 409);
  }
  await replaceLinks(db, id, serverIds);
  await writeAudit(db, userId, { action: "scope_create", result: "ok", scopeType: "project", scopeName: name });
  return ownedProject(db, userId, id);
}

export async function updateProject(db: AppDb, userId: string, id: string, patch: { name?: string; note?: string; serverIds?: string[] }) {
  const current = await ownedProject(db, userId, id);
  if (patch.serverIds) await assertServersOwned(db, userId, patch.serverIds);
  await db.update(projects).set({
    name: patch.name ?? current.name,
    note: patch.note ?? current.note,
    updatedAt: new Date(),
  }).where(eq(projects.id, id));
  if (patch.serverIds) await replaceLinks(db, id, patch.serverIds);
  await writeAudit(db, userId, { action: "scope_update", result: "ok", scopeType: "project", scopeName: patch.name ?? current.name });
  return ownedProject(db, userId, id);
}

export async function deleteProject(db: AppDb, userId: string, id: string) {
  const current = await ownedProject(db, userId, id);
  await db.delete(variables).where(and(eq(variables.userId, userId), eq(variables.projectId, id)));
  await db.delete(projectServers).where(eq(projectServers.projectId, id));
  await db.delete(machineTokens).where(and(eq(machineTokens.userId, userId), eq(machineTokens.projectId, id)));
  await db.delete(projects).where(eq(projects.id, id));
  await writeAudit(db, userId, { action: "scope_delete", result: "ok", scopeType: "project", scopeName: current.name });
}

async function assertServersOwned(db: AppDb, userId: string, serverIds: string[]) {
  for (const id of serverIds) await ownedServer(db, userId, id);
}

async function replaceLinks(db: AppDb, projectId: string, serverIds: string[]) {
  await db.delete(projectServers).where(eq(projectServers.projectId, projectId));
  for (let i = 0; i < serverIds.length; i++) {
    const serverId = serverIds[i];
    if (!serverId) continue;
    await db.insert(projectServers).values({ projectId, serverId, sortOrder: i });
  }
}

export type CipherInput = {
  scopeType: ScopeType;
  serverId?: string | null;
  projectId?: string | null;
  key: string;
  valueCipher: string;
  valueIv: string;
  noteCipher?: string | null;
  noteIv?: string | null;
  type: VarType;
};

function assertKey(key: string) {
  if (!KEY_RE.test(key)) throw new HttpError("BAD_REQUEST", "key 不合法", 400);
}

async function findVariable(db: AppDb, userId: string, input: Pick<CipherInput, "scopeType" | "serverId" | "projectId" | "key">) {
  const rows = await db.select().from(variables).where(and(eq(variables.userId, userId), eq(variables.key, input.key), eq(variables.scopeType, input.scopeType)));
  return rows.find((row) => {
    if (input.scopeType === "public") return !row.serverId && !row.projectId;
    if (input.scopeType === "server") return row.serverId === input.serverId;
    return row.projectId === input.projectId;
  });
}

async function scopeNameOf(db: AppDb, userId: string, scopeType: ScopeType, serverId?: string | null, projectId?: string | null) {
  if (scopeType === "public") return "公共";
  if (scopeType === "server" && serverId) return (await ownedServer(db, userId, serverId)).name;
  if (scopeType === "project" && projectId) return (await ownedProject(db, userId, projectId)).name;
  throw new HttpError("BAD_REQUEST", "作用域不完整", 400);
}

export async function upsertVariable(db: AppDb, userId: string, input: CipherInput, actor = "user") {
  assertKey(input.key);
  const scopeName = await scopeNameOf(db, userId, input.scopeType, input.serverId, input.projectId);
  const existing = await findVariable(db, userId, input);
  if (!existing) {
    const id = crypto.randomUUID();
    await db.insert(variables).values({
      id,
      userId,
      orgId: null,
      scopeType: input.scopeType,
      serverId: input.scopeType === "server" ? input.serverId ?? null : null,
      projectId: input.scopeType === "project" ? input.projectId ?? null : null,
      key: input.key,
      valueCipher: input.valueCipher,
      valueIv: input.valueIv,
      noteCipher: input.noteCipher ?? null,
      noteIv: input.noteIv ?? null,
      type: input.type,
    });
    await writeAudit(db, userId, { action: "var_create", result: "ok", scopeType: input.scopeType, scopeName, keyName: input.key });
    const created = await db.select().from(variables).where(eq(variables.id, id)).limit(1);
    return created[0];
  }
  await pushVersion(db, existing, actor);
  await db.update(variables).set({
    valueCipher: input.valueCipher,
    valueIv: input.valueIv,
    noteCipher: input.noteCipher ?? null,
    noteIv: input.noteIv ?? null,
    type: input.type,
    updatedAt: new Date(),
  }).where(eq(variables.id, existing.id));
  await trimVersions(db, existing.id);
  await writeAudit(db, userId, { action: "var_update", result: "ok", scopeType: input.scopeType, scopeName, keyName: input.key });
  const updated = await db.select().from(variables).where(eq(variables.id, existing.id)).limit(1);
  return updated[0];
}

async function pushVersion(db: AppDb, row: typeof variables.$inferSelect, actor: string) {
  await db.insert(variableVersions).values({
    id: crypto.randomUUID(),
    variableId: row.id,
    valueCipher: row.valueCipher,
    valueIv: row.valueIv,
    noteCipher: row.noteCipher,
    noteIv: row.noteIv,
    type: row.type,
    actor,
  });
}

async function trimVersions(db: AppDb, variableId: string) {
  const rows = await db.select().from(variableVersions).where(eq(variableVersions.variableId, variableId)).orderBy(desc(variableVersions.createdAt));
  const extra = rows.slice(VERSION_KEEP);
  for (const row of extra) {
    await db.delete(variableVersions).where(eq(variableVersions.id, row.id));
  }
}

export async function deleteVariable(db: AppDb, userId: string, id: string) {
  const rows = await db.select().from(variables).where(and(eq(variables.id, id), eq(variables.userId, userId))).limit(1);
  const row = rows[0];
  if (!row) throw new HttpError("NOT_FOUND", "变量不存在", 404);
  const scopeName = await scopeNameOf(db, userId, row.scopeType as ScopeType, row.serverId, row.projectId);
  await db.delete(variableVersions).where(eq(variableVersions.variableId, id));
  await db.delete(variables).where(eq(variables.id, id));
  await writeAudit(db, userId, { action: "var_delete", result: "ok", scopeType: row.scopeType, scopeName, keyName: row.key });
}

export async function listVersions(db: AppDb, userId: string, variableId: string) {
  const rows = await db.select().from(variables).where(and(eq(variables.id, variableId), eq(variables.userId, userId))).limit(1);
  if (!rows[0]) throw new HttpError("NOT_FOUND", "变量不存在", 404);
  return db.select().from(variableVersions).where(eq(variableVersions.variableId, variableId)).orderBy(desc(variableVersions.createdAt));
}

export async function restoreVersion(db: AppDb, userId: string, variableId: string, versionId: string) {
  const rows = await db.select().from(variables).where(and(eq(variables.id, variableId), eq(variables.userId, userId))).limit(1);
  const row = rows[0];
  if (!row) throw new HttpError("NOT_FOUND", "变量不存在", 404);
  const versions = await db.select().from(variableVersions).where(and(eq(variableVersions.id, versionId), eq(variableVersions.variableId, variableId))).limit(1);
  const version = versions[0];
  if (!version) throw new HttpError("NOT_FOUND", "版本不存在", 404);
  await pushVersion(db, row, "restore");
  await db.update(variables).set({
    valueCipher: version.valueCipher,
    valueIv: version.valueIv,
    noteCipher: version.noteCipher,
    noteIv: version.noteIv,
    type: version.type,
    updatedAt: new Date(),
  }).where(eq(variables.id, variableId));
  await trimVersions(db, variableId);
  const scopeName = await scopeNameOf(db, userId, row.scopeType as ScopeType, row.serverId, row.projectId);
  await writeAudit(db, userId, { action: "var_restore", result: "ok", scopeType: row.scopeType, scopeName, keyName: row.key });
  const updated = await db.select().from(variables).where(eq(variables.id, variableId)).limit(1);
  return updated[0];
}

export async function bootstrap(db: AppDb, userId: string) {
  const [serverRows, projectRows, linkRows, variableRows, versionRows, templateRows] = await Promise.all([
    db.select().from(servers).where(eq(servers.userId, userId)),
    db.select().from(projects).where(eq(projects.userId, userId)),
    db.select().from(projectServers),
    db.select().from(variables).where(eq(variables.userId, userId)),
    db.select().from(variableVersions),
    db.select().from(templates).where(eq(templates.userId, userId)),
  ]);
  const projectIds = new Set(projectRows.map((row) => row.id));
  const variableIds = new Set(variableRows.map((row) => row.id));
  return {
    servers: serverRows,
    projects: projectRows,
    links: linkRows.filter((row) => projectIds.has(row.projectId)),
    variables: variableRows,
    versions: versionRows.filter((row) => variableIds.has(row.variableId)),
    templates: templateRows,
  };
}

export async function saveTemplate(db: AppDb, userId: string, name: string, bodyCipher: string, bodyIv: string) {
  const id = crypto.randomUUID();
  await db.insert(templates).values({ id, userId, name, bodyCipher, bodyIv });
  const rows = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
  return rows[0];
}

export async function deleteTemplate(db: AppDb, userId: string, id: string) {
  await db.delete(templates).where(and(eq(templates.id, id), eq(templates.userId, userId)));
}

export async function createToken(db: AppDb, userId: string, input: {
  name: string;
  publicId: string;
  authSecretHash: string;
  publicKeySpki: string;
  wrappedDek: string;
  scopeType: ScopeType;
  serverId?: string | null;
  projectId?: string | null;
  canInject: boolean;
  canReplace: boolean;
  expiresAt: string;
}) {
  if (!input.canInject && !input.canReplace) throw new HttpError("BAD_REQUEST", "至少选择一项权限", 400);
  assertExpiryWindow(new Date(input.expiresAt));
  const scopeName = await scopeNameOf(db, userId, input.scopeType, input.serverId, input.projectId);
  const id = crypto.randomUUID();
  await db.insert(machineTokens).values({
    id,
    userId,
    name: input.name,
    publicId: input.publicId,
    authSecretHash: input.authSecretHash,
    publicKeySpki: input.publicKeySpki,
    wrappedDek: input.wrappedDek,
    scopeType: input.scopeType,
    serverId: input.scopeType === "server" ? input.serverId ?? null : null,
    projectId: input.scopeType === "project" ? input.projectId ?? null : null,
    canInject: input.canInject,
    canReplace: input.canReplace,
    expiresAt: new Date(input.expiresAt),
  });
  await writeAudit(db, userId, { action: "token_create", result: "ok", scopeType: input.scopeType, scopeName, tokenId: id });
  return { id, name: input.name };
}

export async function listTokens(db: AppDb, userId: string) {
  const rows = await db.select().from(machineTokens).where(eq(machineTokens.userId, userId)).orderBy(desc(machineTokens.createdAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    scopeType: row.scopeType,
    serverId: row.serverId,
    projectId: row.projectId,
    canInject: row.canInject,
    canReplace: row.canReplace,
    expiresAt: asDate(row.expiresAt).toISOString(),
    revokedAt: row.revokedAt ? asDate(row.revokedAt).toISOString() : null,
    createdAt: asDate(row.createdAt).toISOString(),
  }));
}

export async function revokeToken(db: AppDb, userId: string, id: string) {
  const rows = await db.select().from(machineTokens).where(and(eq(machineTokens.id, id), eq(machineTokens.userId, userId))).limit(1);
  const row = rows[0];
  if (!row) throw new HttpError("NOT_FOUND", "令牌不存在", 404);
  await db.update(machineTokens).set({ revokedAt: new Date() }).where(eq(machineTokens.id, id));
  await writeAudit(db, userId, { action: "token_revoke", result: "ok", tokenId: id, scopeType: row.scopeType });
}

export async function agentMaterial(db: AppDb, input: { publicId: string; authSecret: string; op: TokenOp }) {
  const hash = await sha256Hex(input.authSecret);
  const rows = await db.select().from(machineTokens).where(eq(machineTokens.publicId, input.publicId)).limit(1);
  const token = rows[0];
  if (!token || !timingSafeEqualHex(hash, token.authSecretHash)) {
    throw new HttpError("UNAUTHORIZED", "令牌无效", 401);
  }
  try {
    assertTokenOp({
      canInject: token.canInject,
      canReplace: token.canReplace,
      expiresAt: asDate(token.expiresAt).toISOString(),
      revokedAt: token.revokedAt ? asDate(token.revokedAt).toISOString() : null,
    }, input.op);
  } catch (err) {
    await writeAudit(db, token.userId, {
      action: "token_use",
      result: "fail",
      tokenId: token.id,
      scopeType: token.scopeType,
      meta: { op: input.op, reason: "denied" },
    });
    throw err;
  }
  const data = await bootstrap(db, token.userId);
  const serverOrder = data.links
    .filter((link) => link.projectId === token.projectId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((link) => link.serverId);
  const allowedServers = new Set(serverOrder);
  const selected = data.variables.filter((row) => {
    if (token.scopeType === "public") return row.scopeType === "public";
    if (token.scopeType === "server") {
      return row.scopeType === "public" || (row.scopeType === "server" && row.serverId === token.serverId);
    }
    return row.scopeType === "public"
      || (row.scopeType === "server" && allowedServers.has(row.serverId ?? ""))
      || (row.scopeType === "project" && row.projectId === token.projectId);
  });
  const serverNames = new Map(data.servers.map((row) => [row.id, row.name]));
  const projectNames = new Map(data.projects.map((row) => [row.id, row.name]));
  const material = buildAgentMaterial({
    op: input.op,
    scopeType: token.scopeType as ScopeType,
    scopeId: token.serverId ?? token.projectId ?? null,
    wrappedDek: token.wrappedDek,
    publicKeySpki: token.publicKeySpki,
    serverOrder: token.scopeType === "project" ? serverOrder : [],
    variables: selected.map((row) => ({
      id: row.id,
      key: row.key,
      scopeType: row.scopeType as ScopeType,
      scopeId: row.serverId ?? row.projectId ?? null,
      scopeName: row.scopeType === "server"
        ? serverNames.get(row.serverId ?? "") ?? "服务器"
        : row.scopeType === "project"
          ? projectNames.get(row.projectId ?? "") ?? "项目"
          : "公共",
      type: row.type as VarType,
      valueCipher: row.valueCipher,
      valueIv: row.valueIv,
      noteCipher: row.noteCipher,
      noteIv: row.noteIv,
      updatedAt: asDate(row.updatedAt).toISOString(),
    })),
  });
  await writeAudit(db, token.userId, {
    action: "token_use",
    result: "ok",
    tokenId: token.id,
    scopeType: token.scopeType,
    meta: { op: input.op, count: material.variables.length, keys: material.variables.map((row) => row.key) },
  });
  return material;
}

export async function migrateVault(db: AppDb, userId: string, body: {
  servers: { name: string; note?: string }[];
  projects: { name: string; note?: string; serverNames: string[] }[];
  variables: (CipherInput & { scopeName: string })[];
  templates: { name: string; bodyCipher: string; bodyIv: string }[];
}) {
  const serverIdByName = new Map<string, string>();
  const existingServers = await db.select().from(servers).where(eq(servers.userId, userId));
  for (const row of existingServers) serverIdByName.set(row.name, row.id);
  for (const server of body.servers) {
    const existingId = serverIdByName.get(server.name);
    if (existingId) {
      await updateServer(db, userId, existingId, { note: server.note ?? "" });
    } else {
      const created = await createServer(db, userId, server.name, server.note ?? "");
      serverIdByName.set(server.name, created.id);
    }
  }
  const projectIdByName = new Map<string, string>();
  const existingProjects = await db.select().from(projects).where(eq(projects.userId, userId));
  for (const row of existingProjects) projectIdByName.set(row.name, row.id);
  for (const project of body.projects) {
    const serverIds = project.serverNames.map((name) => {
      const id = serverIdByName.get(name);
      if (!id) throw new HttpError("BAD_REQUEST", "迁移引用了未知服务器", 400);
      return id;
    });
    const existingId = projectIdByName.get(project.name);
    if (existingId) {
      await updateProject(db, userId, existingId, { note: project.note ?? "", serverIds });
    } else {
      const created = await createProject(db, userId, project.name, project.note ?? "", serverIds);
      projectIdByName.set(project.name, created.id);
    }
  }
  let created = 0;
  let overwritten = 0;
  for (const variable of body.variables) {
    const serverId = variable.scopeType === "server" ? serverIdByName.get(variable.scopeName) : null;
    const projectId = variable.scopeType === "project" ? projectIdByName.get(variable.scopeName) : null;
    if (variable.scopeType === "server" && !serverId) throw new HttpError("BAD_REQUEST", "迁移引用了未知服务器", 400);
    if (variable.scopeType === "project" && !projectId) throw new HttpError("BAD_REQUEST", "迁移引用了未知项目", 400);
    const before = await findVariable(db, userId, { ...variable, serverId, projectId });
    await upsertVariable(db, userId, { ...variable, serverId, projectId }, "migration");
    if (!before) created += 1;
    else if (before.valueCipher !== variable.valueCipher) overwritten += 1;
  }
  for (const template of body.templates) {
    await saveTemplate(db, userId, template.name, template.bodyCipher, template.bodyIv);
  }
  await writeAudit(db, userId, {
    action: "migrate",
    result: "ok",
    meta: { imported: created, overwritten },
  });
  return { created, overwritten };
}

export async function transferVariables(db: AppDb, userId: string, input: {
  ids: string[];
  targetScopeType: ScopeType;
  targetServerId?: string | null;
  targetProjectId?: string | null;
  mode: TransferMode;
  conflict: ConflictPolicy;
}) {
  const targetScopeId = input.targetScopeType === "server" ? input.targetServerId ?? null : input.targetScopeType === "project" ? input.targetProjectId ?? null : null;
  await scopeNameOf(db, userId, input.targetScopeType, input.targetServerId, input.targetProjectId);
  const owned = await db.select().from(variables).where(eq(variables.userId, userId));
  const selected = owned.filter((row) => input.ids.includes(row.id));
  if (selected.length !== input.ids.length) throw new HttpError("NOT_FOUND", "有变量不存在", 404);
  const plan = planTransfer({
    variables: owned.map((row) => ({
      id: row.id,
      key: row.key,
      scopeType: row.scopeType as ScopeType,
      scopeId: row.serverId ?? row.projectId ?? null,
    })),
    ids: input.ids,
    target: { type: input.targetScopeType, id: targetScopeId },
    mode: input.mode,
    conflict: input.conflict,
    newId: () => crypto.randomUUID(),
  });
  for (const op of plan.ops) {
    if (op.op === "delete") {
      await db.delete(variableVersions).where(eq(variableVersions.variableId, op.id));
      await db.delete(variables).where(and(eq(variables.id, op.id), eq(variables.userId, userId)));
    } else if (op.op === "move") {
      await db.update(variables).set({
        key: op.key,
        scopeType: op.scopeType,
        serverId: op.scopeType === "server" ? op.scopeId : null,
        projectId: op.scopeType === "project" ? op.scopeId : null,
        updatedAt: new Date(),
      }).where(and(eq(variables.id, op.id), eq(variables.userId, userId)));
    } else if (op.op === "copy") {
      const source = owned.find((row) => row.id === op.sourceId);
      if (!source) continue;
      await db.insert(variables).values({
        id: op.newId,
        userId,
        orgId: null,
        scopeType: op.scopeType,
        serverId: op.scopeType === "server" ? op.scopeId : null,
        projectId: op.scopeType === "project" ? op.scopeId : null,
        key: op.key,
        valueCipher: source.valueCipher,
        valueIv: source.valueIv,
        noteCipher: source.noteCipher,
        noteIv: source.noteIv,
        type: source.type,
      });
    } else if (op.op === "overwrite-copy") {
      const source = owned.find((row) => row.id === op.sourceId);
      const target = owned.find((row) => row.id === op.targetId);
      if (!source || !target) continue;
      await pushVersion(db, target, "transfer");
      await db.update(variables).set({
        valueCipher: source.valueCipher,
        valueIv: source.valueIv,
        noteCipher: source.noteCipher,
        noteIv: source.noteIv,
        type: source.type,
        updatedAt: new Date(),
      }).where(and(eq(variables.id, target.id), eq(variables.userId, userId)));
      await trimVersions(db, target.id);
    }
  }
  const targetName = await scopeNameOf(db, userId, input.targetScopeType, input.targetServerId, input.targetProjectId);
  const serverRows = await db.select().from(servers).where(eq(servers.userId, userId));
  const projectRows = await db.select().from(projects).where(eq(projects.userId, userId));
  const sourceNames = [...new Set(selected.map((row) => {
    if (row.scopeType === "public") return "公共";
    if (row.scopeType === "server") return serverRows.find((item) => item.id === row.serverId)?.name ?? "服务器";
    return projectRows.find((item) => item.id === row.projectId)?.name ?? "项目";
  }))];
  await writeAudit(db, userId, {
    action: "transfer",
    result: "ok",
    scopeType: input.targetScopeType,
    scopeName: targetName,
    keyName: selected.length === 1 ? selected[0]?.key : null,
    meta: {
      mode: input.mode,
      source: sourceNames.join(",").slice(0, 80),
      target: targetName,
      keys: selected.map((row) => row.key),
      moved: plan.counts.moved,
      copied: plan.counts.copied,
      skipped: plan.counts.skipped,
      overwritten: plan.counts.overwritten,
      kept: plan.counts.kept,
    },
  });
  return plan.counts;
}
