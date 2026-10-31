import { describe, expect, it } from "vitest";
import { mergeEffective } from "./merge";
import { applyPlainTransfer, planTransfer, type PlainVar } from "./transfer";
import type { VarRef } from "./types";

function variable(partial: Partial<PlainVar> & Pick<PlainVar, "id" | "key" | "scopeType" | "value">): PlainVar {
  return { scopeId: null, type: "secret", note: "", updatedAt: "2024-01-01T00:00:00.000Z", ...partial };
}

function run(variables: PlainVar[], ids: string[], target: PlainVar["scopeType"], targetId: string | null, mode: "move" | "copy", conflict: "skip" | "overwrite" | "keep") {
  const plan = planTransfer({
    variables,
    ids,
    target: { type: target, id: targetId },
    mode,
    conflict,
    newId: (() => {
      let n = 0;
      return () => `new-${++n}`;
    })(),
  });
  return { plan, variables: applyPlainTransfer(variables, plan) };
}

describe("transfer conflicts", () => {
  const source = [
    variable({ id: "a", key: "TOKEN", scopeType: "project", scopeId: "api", value: "proj" }),
    variable({ id: "b", key: "TOKEN", scopeType: "public", value: "pub" }),
  ];

  it("skips, overwrites, or keeps both", () => {
    const skipped = run(source, ["a"], "public", null, "move", "skip");
    expect(skipped.plan.counts.skipped).toBe(1);
    expect(skipped.variables.find((row) => row.id === "a")?.scopeType).toBe("project");

    const overwritten = run(source, ["a"], "public", null, "move", "overwrite");
    expect(overwritten.plan.counts.overwritten).toBe(1);
    expect(overwritten.variables.find((row) => row.id === "b")).toBeUndefined();
    expect(overwritten.variables.find((row) => row.id === "a")).toMatchObject({ scopeType: "public", value: "proj" });

    const kept = run(source, ["a"], "public", null, "copy", "keep");
    expect(kept.plan.counts.kept).toBe(1);
    expect(kept.variables.find((row) => row.id === "a")?.scopeType).toBe("project");
    expect(kept.variables.find((row) => row.key === "TOKEN_copy")?.value).toBe("proj");
  });

  it("move clears the source and copy keeps it", () => {
    const moved = run(source, ["a"], "server", "web", "move", "skip");
    expect(moved.variables.filter((row) => row.scopeType === "project")).toEqual([]);
    expect(moved.variables.find((row) => row.id === "a")?.scopeId).toBe("web");

    const copied = run(source, ["a"], "server", "web", "copy", "skip");
    expect(copied.variables.filter((row) => row.scopeType === "project")).toHaveLength(1);
    expect(copied.variables.filter((row) => row.scopeId === "web")).toHaveLength(1);
  });

  it("changes the effective view after a move without a second confirm", () => {
    const moved = run(source, ["a"], "server", "web", "move", "skip");
    const asRefs: VarRef[] = moved.variables.map((row) => ({ ...row }));
    const projectView = mergeEffective(asRefs, { type: "project", projectId: "api" });
    expect(projectView.find((group) => group.key === "TOKEN")?.winner.value).toBe("pub");
    const serverView = mergeEffective(asRefs, { type: "server", serverId: "web" });
    expect(serverView.find((group) => group.key === "TOKEN")?.winner.value).toBe("proj");
  });
});
