import { describe, expect, it } from "vitest";
import { activeEntries, mergeEffective } from "./merge";
import type { VarRef } from "./types";

function row(partial: Partial<VarRef> & Pick<VarRef, "id" | "key" | "scopeType" | "value">): VarRef {
  return {
    scopeId: null,
    type: "secret",
    note: "",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("mergeEffective", () => {
  const vars: VarRef[] = [
    row({ id: "1", key: "API_URL", scopeType: "public", value: "https://public" }),
    row({ id: "2", key: "TOKEN", scopeType: "public", value: "pub" }),
    row({ id: "3", key: "API_URL", scopeType: "server", scopeId: "web", value: "https://web" }),
    row({ id: "4", key: "ONLY_SERVER", scopeType: "server", scopeId: "web", value: "1" }),
    row({ id: "5", key: "API_URL", scopeType: "server", scopeId: "db", value: "https://db" }),
    row({ id: "6", key: "API_URL", scopeType: "project", scopeId: "api", value: "https://api" }),
    row({ id: "7", key: "TOKEN", scopeType: "project", scopeId: "api", value: "proj" }),
    row({ id: "8", key: "OTHER", scopeType: "project", scopeId: "other", value: "nope" }),
  ];

  it("project overrides later server which overrides earlier server and public", () => {
    const groups = mergeEffective(vars, { type: "project", projectId: "api" }, ["web", "db"]);
    const api = groups.find((g) => g.key === "API_URL");
    expect(api?.winner.value).toBe("https://api");
    expect(api?.overridden.map((r) => r.value)).toEqual(["https://db", "https://web", "https://public"]);
    const token = groups.find((g) => g.key === "TOKEN");
    expect(token?.winner.value).toBe("proj");
    expect(token?.overridden.map((r) => r.id)).toEqual(["2"]);
    expect(groups.find((g) => g.key === "ONLY_SERVER")?.winner.scopeId).toBe("web");
    expect(groups.find((g) => g.key === "OTHER")).toBeUndefined();
  });

  it("server view ignores project layer", () => {
    const groups = mergeEffective(vars, { type: "server", serverId: "web" });
    expect(groups.find((g) => g.key === "API_URL")?.winner.value).toBe("https://web");
    expect(groups.find((g) => g.key === "TOKEN")?.winner.value).toBe("pub");
    expect(groups.map((g) => g.key)).not.toContain("OTHER");
    expect(activeEntries(groups).every((row) => row.scopeType !== "project")).toBe(true);
  });

  it("public view is only the public layer", () => {
    const groups = mergeEffective(vars, { type: "public" });
    expect(groups.map((g) => g.key)).toEqual(["API_URL", "TOKEN"]);
    expect(groups.every((g) => g.overridden.length === 0)).toBe(true);
  });

  it("active set excludes overridden rows", () => {
    const groups = mergeEffective(vars, { type: "project", projectId: "api" }, ["web", "db"]);
    const active = activeEntries(groups);
    expect(active.find((r) => r.key === "API_URL")?.value).toBe("https://api");
    expect(active).toHaveLength(groups.length);
  });
});
