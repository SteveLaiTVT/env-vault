import type { ScopeType, VarRef, ViewSelection } from "./types";

export type EffectiveGroup = {
  key: string;
  winner: VarRef;
  overridden: VarRef[];
};

function rank(variable: VarRef, view: ViewSelection, serverOrder: string[]): number | null {
  if (view.type === "public") {
    return variable.scopeType === "public" ? 0 : null;
  }
  if (view.type === "server") {
    if (variable.scopeType === "public") return 0;
    if (variable.scopeType === "server" && variable.scopeId === view.serverId) return 1;
    return null;
  }
  if (variable.scopeType === "public") return 0;
  if (variable.scopeType === "server") {
    const idx = serverOrder.indexOf(variable.scopeId ?? "");
    if (idx < 0) return null;
    return 1 + idx;
  }
  if (variable.scopeType === "project" && variable.scopeId === view.projectId) return 1000;
  return null;
}

export function mergeEffective(variables: VarRef[], view: ViewSelection, serverOrder: string[] = []): EffectiveGroup[] {
  const buckets = new Map<string, { rank: number; row: VarRef }[]>();
  for (const row of variables) {
    const r = rank(row, view, serverOrder);
    if (r === null) continue;
    const list = buckets.get(row.key) ?? [];
    list.push({ rank: r, row });
    buckets.set(row.key, list);
  }
  const groups: EffectiveGroup[] = [];
  for (const [key, list] of buckets) {
    const sorted = [...list].sort((a, b) => b.rank - a.rank || b.row.updatedAt.localeCompare(a.row.updatedAt));
    const winner = sorted[0]?.row;
    if (!winner) continue;
    groups.push({
      key,
      winner,
      overridden: sorted.slice(1).map((item) => item.row),
    });
  }
  groups.sort((a, b) => a.key.localeCompare(b.key));
  return groups;
}

export function activeEntries(groups: EffectiveGroup[]): VarRef[] {
  return groups.map((g) => g.winner);
}

export function scopeRankLabel(scopeType: ScopeType): string {
  if (scopeType === "public") return "公共";
  if (scopeType === "server") return "服务器";
  return "项目";
}
