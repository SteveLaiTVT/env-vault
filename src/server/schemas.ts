import { z } from "zod";
import { KEY_RE } from "../lib/types";

export const emailSchema = z.string().trim().email().max(200);

export const registerSchema = z.object({
  email: emailSchema,
  authKey: z.string().min(16).max(200),
  kdfSalt: z.string().min(8).max(200),
  kdfMemory: z.number().int().min(8).max(65536),
  kdfIterations: z.number().int().min(1).max(10),
  kdfParallelism: z.number().int().min(1).max(4),
  wrappedDek: z.string().min(8).max(8000),
  dekIv: z.string().min(8).max(200),
});

export const loginSchema = z.object({
  email: emailSchema,
  authKey: z.string().min(16).max(200),
});

export const nameSchema = z.object({
  name: z.string().trim().min(1).max(80),
  note: z.string().max(2000).optional().default(""),
});

export const projectSchema = nameSchema.extend({
  serverIds: z.array(z.string().uuid()).max(50).optional().default([]),
});

export const projectPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  note: z.string().max(2000).optional(),
  serverIds: z.array(z.string().uuid()).max(50).optional(),
});

export const cipherSchema = z.object({
  scopeType: z.enum(["public", "server", "project"]),
  serverId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  key: z.string().regex(KEY_RE),
  valueCipher: z.string().min(1).max(200000),
  valueIv: z.string().min(1).max(200),
  noteCipher: z.string().max(200000).nullable().optional(),
  noteIv: z.string().max(200).nullable().optional(),
  type: z.enum(["secret", "plain"]),
});

export const batchSchema = z.object({
  items: z.array(cipherSchema).min(1).max(500),
});

export const auditSchema = z.object({
  action: z.enum(["reveal", "copy", "download", "backup_export", "backup_import", "paste", "import", "transfer"]),
  result: z.enum(["ok", "fail"]).default("ok"),
  scopeType: z.enum(["public", "server", "project"]).optional(),
  scopeName: z.string().max(80).optional(),
  keyName: z.string().regex(KEY_RE).optional(),
  meta: z.unknown().optional(),
});

export const tokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  publicId: z.string().uuid(),
  authSecretHash: z.string().regex(/^[0-9a-f]{64}$/),
  publicKeySpki: z.string().min(32).max(8000),
  wrappedDek: z.string().min(32).max(8000),
  scopeType: z.enum(["public", "server", "project"]),
  serverId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  canInject: z.boolean(),
  canReplace: z.boolean(),
  expiresAt: z.string().datetime(),
});

export const agentSchema = z.object({
  publicId: z.string().uuid(),
  authSecret: z.string().min(10).max(200),
  op: z.enum(["inject", "replace"]),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  bodyCipher: z.string().min(1).max(200000),
  bodyIv: z.string().min(1).max(200),
});

export const aiSchema = z.object({
  description: z.string().max(2000).default(""),
  sample: z.string().max(4000).default(""),
  keyNames: z.array(z.string()).max(200),
});

export const migrateSchema = z.object({
  servers: z.array(z.object({ name: z.string().trim().min(1).max(80), note: z.string().max(2000).default("") })).max(100),
  projects: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    note: z.string().max(2000).default(""),
    serverNames: z.array(z.string()).max(50),
  })).max(100),
  variables: z.array(cipherSchema.extend({ scopeName: z.string().max(80) })).max(500),
  templates: z.array(templateSchema).max(50).default([]),
});

export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const body = await req.json().catch(() => null);
  return schema.parse(body);
}
