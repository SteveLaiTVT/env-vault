import { iso } from "./http";

type Dated = { createdAt: Date | string; updatedAt?: Date | string };

export function serializeServer(row: { id: string; name: string; note: string } & Dated) {
  return { id: row.id, name: row.name, note: row.note, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}

export function serializeProject(row: { id: string; name: string; note: string } & Dated) {
  return serializeServer(row);
}

export function serializeVariable(row: {
  id: string;
  scopeType: string;
  serverId: string | null;
  projectId: string | null;
  key: string;
  valueCipher: string;
  valueIv: string;
  noteCipher: string | null;
  noteIv: string | null;
  type: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}) {
  return {
    id: row.id,
    scopeType: row.scopeType,
    serverId: row.serverId,
    projectId: row.projectId,
    key: row.key,
    valueCipher: row.valueCipher,
    valueIv: row.valueIv,
    noteCipher: row.noteCipher,
    noteIv: row.noteIv,
    type: row.type,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function serializeVersion(row: {
  id: string;
  variableId: string;
  valueCipher: string;
  valueIv: string;
  noteCipher: string | null;
  noteIv: string | null;
  type: string;
  actor: string;
  createdAt: Date | string;
}) {
  return {
    id: row.id,
    variableId: row.variableId,
    valueCipher: row.valueCipher,
    valueIv: row.valueIv,
    noteCipher: row.noteCipher,
    noteIv: row.noteIv,
    type: row.type,
    actor: row.actor,
    createdAt: iso(row.createdAt),
  };
}

export function serializeAudit(row: {
  id: string;
  action: string;
  result: string;
  scopeType: string | null;
  scopeName: string | null;
  keyName: string | null;
  tokenId: string | null;
  meta: unknown;
  createdAt: Date | string;
}) {
  return {
    id: row.id,
    action: row.action,
    result: row.result,
    scopeType: row.scopeType,
    scopeName: row.scopeName,
    keyName: row.keyName,
    tokenId: row.tokenId,
    meta: row.meta,
    createdAt: iso(row.createdAt),
  };
}

export function serializeTemplate(row: {
  id: string;
  name: string;
  bodyCipher: string;
  bodyIv: string;
  createdAt: Date | string;
}) {
  return { id: row.id, name: row.name, bodyCipher: row.bodyCipher, bodyIv: row.bodyIv, createdAt: iso(row.createdAt) };
}
