import type { ScopeType, VarType } from "./types";

export type ServerRecord = {
  id: string;
  name: string;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectRecord = ServerRecord;

export type LinkRecord = {
  projectId: string;
  serverId: string;
  sortOrder: number;
};

export type StoredVar = {
  id: string;
  scopeType: ScopeType;
  scopeId: string | null;
  key: string;
  type: VarType;
  valueCipher: string;
  valueIv: string;
  noteCipher: string | null;
  noteIv: string | null;
  updatedAt: string;
  createdAt: string;
};

export type DecryptedVar = StoredVar & {
  value: string;
  note: string;
};

export type StoredVersion = {
  id: string;
  variableId: string;
  valueCipher: string;
  valueIv: string;
  noteCipher: string | null;
  noteIv: string | null;
  type: VarType;
  actor: string;
  createdAt: string;
};

export type StoredTemplate = {
  id: string;
  name: string;
  bodyCipher: string;
  bodyIv: string;
  createdAt: string;
};

export type AuditItem = {
  id: string;
  action: string;
  result: string;
  scopeType?: string | null;
  scopeName?: string | null;
  keyName?: string | null;
  meta?: Record<string, string | number | string[]>;
  createdAt: string;
};

export type VaultMeta = {
  kdfSalt: string;
  kdfMemory: number;
  kdfIterations: number;
  kdfParallelism: number;
  wrappedDek: string;
  dekIv: string;
  canaryCipher: string;
  canaryIv: string;
};

export type LocalSnapshot = {
  meta: VaultMeta;
  servers: ServerRecord[];
  projects: ProjectRecord[];
  links: LinkRecord[];
  variables: StoredVar[];
  versions: StoredVersion[];
  templates: StoredTemplate[];
  audits: AuditItem[];
};

export const CANARY = "env-vault-ok";

export function emptySnapshot(meta: VaultMeta): LocalSnapshot {
  return { meta, servers: [], projects: [], links: [], variables: [], versions: [], templates: [], audits: [] };
}
