import { boolean, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  kdfSalt: text("kdf_salt").notNull(),
  kdfMemory: integer("kdf_memory").notNull(),
  kdfIterations: integer("kdf_iterations").notNull(),
  kdfParallelism: integer("kdf_parallelism").notNull(),
  authSalt: text("auth_salt").notNull(),
  authHash: text("auth_hash").notNull(),
  wrappedDek: text("wrapped_dek").notNull(),
  dekIv: text("dek_iv").notNull(),
  orgId: text("org_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const servers = pgTable(
  "servers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orgId: text("org_id"),
    name: text("name").notNull(),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("servers_user_name").on(t.userId, t.name)],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orgId: text("org_id"),
    name: text("name").notNull(),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("projects_user_name").on(t.userId, t.name)],
);

export const projectServers = pgTable("project_servers", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull(),
});

export const variables = pgTable("variables", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: text("org_id"),
  scopeType: text("scope_type").notNull(),
  serverId: text("server_id").references(() => servers.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  valueCipher: text("value_cipher").notNull(),
  valueIv: text("value_iv").notNull(),
  noteCipher: text("note_cipher"),
  noteIv: text("note_iv"),
  type: text("type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const variableVersions = pgTable("variable_versions", {
  id: text("id").primaryKey(),
  variableId: text("variable_id").notNull().references(() => variables.id, { onDelete: "cascade" }),
  valueCipher: text("value_cipher").notNull(),
  valueIv: text("value_iv").notNull(),
  noteCipher: text("note_cipher"),
  noteIv: text("note_iv"),
  type: text("type").notNull(),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  result: text("result").notNull(),
  scopeType: text("scope_type"),
  scopeName: text("scope_name"),
  keyName: text("key_name"),
  tokenId: text("token_id"),
  meta: jsonb("meta").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const machineTokens = pgTable("machine_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  publicId: text("public_id").notNull().unique(),
  authSecretHash: text("auth_secret_hash").notNull(),
  publicKeySpki: text("public_key_spki").notNull(),
  wrappedDek: text("wrapped_dek").notNull(),
  scopeType: text("scope_type").notNull(),
  serverId: text("server_id").references(() => servers.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  canInject: boolean("can_inject").notNull(),
  canReplace: boolean("can_replace").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const templates = pgTable("templates", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  bodyCipher: text("body_cipher").notNull(),
  bodyIv: text("body_iv").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
