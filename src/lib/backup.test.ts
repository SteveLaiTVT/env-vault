import { describe, expect, it } from "vitest";
import { migrationCounts, parseBackup } from "./backup";

describe("backup", () => {
  it("counts local-over-cloud migration without exposing a third state", () => {
    const counts = migrationCounts(
      [
        { scopeType: "public", scopeName: "", key: "A", type: "secret", value: "1", note: "", updatedAt: "" },
        { scopeType: "server", scopeName: "web", key: "B", type: "plain", value: "new", note: "", updatedAt: "" },
      ],
      [
        { scopeType: "server", scopeName: "web", key: "B", type: "plain", value: "old", note: "", updatedAt: "" },
        { scopeType: "public", scopeName: "", key: "C", type: "secret", value: "stay", note: "", updatedAt: "" },
      ],
    );
    expect(counts).toEqual({ added: 1, overwritten: 1, unchanged: 0 });
  });

  it("rejects unknown backup versions", () => {
    expect(() => parseBackup({ format: "other" })).toThrow();
  });
});
