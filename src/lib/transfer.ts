import { KEY_RE, type ScopeType } from "./types";

export type TransferMode = "move" | "copy";
export type ConflictPolicy = "skip" | "overwrite" | "keep";

export type TransferScope = { type: ScopeType; id: string | null };

export type TransferCounts = {
  moved: number;
  copied: number;
  skipped: number;
  overwritten: number;
  kept: number;
};

export type TransferOp =
  | { op: "move"; id: string; key: string; scopeType: ScopeType; scopeId: string | null }
  | { op: "copy"; sourceId: string; newId: string; key: string; scopeType: ScopeType; scopeId: string | null }
  | { op: "overwrite-copy"; targetId: string; sourceId: string }
  | { op: "delete"; id: string }
  | { op: "skip"; id: string };

export function planTransfer(input: {
  variables: { id: string; key: string; scopeType: ScopeType; scopeId: string | null }[];
  ids: string[];
  target: TransferScope;
  mode: TransferMode;
  conflict: ConflictPolicy;
  newId?: () => string;
}): { ops: TransferOp[]; counts: TransferCounts } {
  const counts: TransferCounts = { moved: 0, copied: 0, skipped: 0, overwritten: 0, kept: 0 };
  const ops: TransferOp[] = [];
  const byScope = new Map<string, { id: string; key: string }[]>();
  for (const row of input.variables) {
    const list = byScope.get(scopeKey(row.scopeType, row.scopeId)) ?? [];
    list.push({ id: row.id, key: row.key });
    byScope.set(scopeKey(row.scopeType, row.scopeId), list);
  }
  const targetKey = scopeKey(input.target.type, input.target.id);
  const occupied = new Map((byScope.get(targetKey) ?? []).map((row) => [row.key, row.id]));
  let seq = 0;
  const nextId = input.newId ?? (() => `copy-${++seq}`);

  for (const id of input.ids) {
    const source = input.variables.find((row) => row.id === id);
    if (!source || !KEY_RE.test(source.key)) {
      counts.skipped += 1;
      ops.push({ op: "skip", id });
      continue;
    }
    const sameScope = source.scopeType === input.target.type && source.scopeId === input.target.id;
    const conflictId = occupied.get(source.key);
    const conflict = Boolean(conflictId && conflictId !== source.id);
    if (input.mode === "move" && sameScope && !conflict) {
      counts.skipped += 1;
      ops.push({ op: "skip", id });
      continue;
    }
    if (conflict && input.conflict === "skip") {
      counts.skipped += 1;
      ops.push({ op: "skip", id });
      continue;
    }
    if (conflict && input.conflict === "overwrite" && input.mode === "copy") {
      ops.push({ op: "overwrite-copy", targetId: conflictId ?? "", sourceId: source.id });
      counts.overwritten += 1;
      continue;
    }
    if (conflict && input.conflict === "overwrite" && input.mode === "move") {
      ops.push({ op: "delete", id: conflictId ?? "" });
      occupied.delete(source.key);
      ops.push({ op: "move", id: source.id, key: source.key, scopeType: input.target.type, scopeId: input.target.id });
      occupied.set(source.key, source.id);
      counts.overwritten += 1;
      continue;
    }
    if (conflict && input.conflict === "keep") {
      const key = nextCopyKey(source.key, occupied);
      if (input.mode === "move") {
        ops.push({ op: "move", id: source.id, key, scopeType: input.target.type, scopeId: input.target.id });
        occupied.set(key, source.id);
      } else {
        const newId = nextId();
        ops.push({ op: "copy", sourceId: source.id, newId, key, scopeType: input.target.type, scopeId: input.target.id });
        occupied.set(key, newId);
      }
      counts.kept += 1;
      continue;
    }
    if (input.mode === "move") {
      ops.push({ op: "move", id: source.id, key: source.key, scopeType: input.target.type, scopeId: input.target.id });
      occupied.set(source.key, source.id);
      counts.moved += 1;
    } else {
      const newId = nextId();
      ops.push({ op: "copy", sourceId: source.id, newId, key: source.key, scopeType: input.target.type, scopeId: input.target.id });
      occupied.set(source.key, newId);
      counts.copied += 1;
    }
  }
  return { ops, counts };
}

export function nextCopyKey(key: string, occupied: Map<string, string>): string {
  let candidate = `${key}_copy`;
  let n = 2;
  while (occupied.has(candidate)) {
    candidate = `${key}_copy${n}`;
    n += 1;
  }
  return candidate;
}

function scopeKey(scopeType: ScopeType, scopeId: string | null): string {
  return `${scopeType}\u0000${scopeId ?? ""}`;
}

export type PlainVar = {
  id: string;
  key: string;
  value: string;
  scopeType: ScopeType;
  scopeId: string | null;
  type: "secret" | "plain";
  note: string;
  updatedAt: string;
};

export function applyPlainTransfer(variables: PlainVar[], plan: { ops: TransferOp[] }): PlainVar[] {
  const next = variables.map((row) => ({ ...row }));
  for (const op of plan.ops) {
    if (op.op === "delete") {
      const index = next.findIndex((row) => row.id === op.id);
      if (index >= 0) next.splice(index, 1);
    } else if (op.op === "move") {
      const row = next.find((item) => item.id === op.id);
      if (!row) continue;
      row.key = op.key;
      row.scopeType = op.scopeType;
      row.scopeId = op.scopeId;
    } else if (op.op === "copy") {
      const source = next.find((item) => item.id === op.sourceId);
      if (!source) continue;
      next.push({ ...source, id: op.newId, key: op.key, scopeType: op.scopeType, scopeId: op.scopeId });
    } else if (op.op === "overwrite-copy") {
      const source = next.find((item) => item.id === op.sourceId);
      const target = next.find((item) => item.id === op.targetId);
      if (!source || !target) continue;
      target.value = source.value;
      target.type = source.type;
      target.note = source.note;
    }
  }
  return next;
}
