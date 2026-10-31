import { describe, expect, it } from "vitest";
import { parseImportFile, summarizeImport, undoImportBatch } from "./import-files";

describe("parseImportFile", () => {
  it("parses env, json, and yaml, and reports illegal lines", () => {
    const env = parseImportFile("app.env", "FOO=bar\nNOPE\n# c\n");
    expect(env.rows).toEqual([{ key: "FOO", value: "bar", line: 1 }]);
    expect(env.errors[0]?.line).toBe(2);

    const json = parseImportFile("app.json", '{"FOO":"bar","N":1,"BAD":{"a":1}}');
    expect(json.rows.map((row) => row.key)).toEqual(["FOO", "N"]);
    expect(json.rows.find((row) => row.key === "N")?.value).toBe("1");
    expect(json.errors[0]?.error).toContain("扁平");

    const yaml = parseImportFile("app.yml", "FOO: bar\nBAZ: \"a b\"\nBAD\n  nested: 1\n");
    expect(yaml.rows.map((row) => [row.key, row.value])).toEqual([["FOO", "bar"], ["BAZ", "a b"]]);
    expect(yaml.errors.map((item) => item.line)).toEqual([3, 4]);
  });

  it("rejects unknown extensions without sending values anywhere", () => {
    const parsed = parseImportFile("secrets.txt", "TOKEN=hidden");
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors[0]?.error).toContain(".env");
  });
});

describe("summarizeImport", () => {
  const existing = [{ scopeType: "public" as const, scopeId: null, key: "FOO" }];

  it("counts added and overwritten separately and blocks over 500", () => {
    const stats = summarizeImport(existing, [{
      target: { scopeType: "public", scopeId: null },
      rows: [{ key: "FOO" }, { key: "BAR" }, { key: "BAR" }],
      errorCount: 1,
    }]);
    expect(stats).toEqual({ added: 1, overwritten: 2, failed: 1, blocked: false });
    const tooMany = summarizeImport([], [{
      target: { scopeType: "server", scopeId: "s1" },
      rows: Array.from({ length: 501 }, (_, i) => ({ key: `K${i}` })),
      errorCount: 0,
    }]);
    expect(tooMany.blocked).toBe(true);
    expect(tooMany.added).toBe(0);
  });

  it("undoes one batch by deleting new keys and restoring overwritten values", () => {
    const before = { id: "1", key: "FOO", value: "old", scopeType: "public" as const, scopeId: null };
    const created = { id: "2", key: "BAR", value: "new", scopeType: "public" as const, scopeId: null };
    const overwritten = { ...before, value: "replaced" };
    const restored = undoImportBatch([overwritten, created], [
      { id: "1", prev: before },
      { id: "2", prev: null },
    ]);
    expect(restored).toEqual([before]);
  });
});
