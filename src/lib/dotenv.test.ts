import { describe, expect, it } from "vitest";
import { parseDotenv } from "./dotenv";

describe("parseDotenv", () => {
  it("accepts comments, export, and quotes", () => {
    const parsed = parseDotenv('# c\nexport FOO=bar\nBAZ="a\\nb"\n\n');
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      { key: "FOO", value: "bar", line: 2 },
      { key: "BAZ", value: "a\nb", line: 3 },
    ]);
  });

  it("reports invalid lines and does not invent rows", () => {
    const parsed = parseDotenv("NOPE\nOK=1\n");
    expect(parsed.rows.map((r) => r.key)).toEqual(["OK"]);
    expect(parsed.errors[0]?.line).toBe(1);
  });
});
