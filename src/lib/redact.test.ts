import { describe, expect, it } from "vitest";
import { redactOutput } from "./redact";

describe("redactOutput", () => {
  it("redacts secrets of any length and only long plain values", () => {
    const text = redactOutput("token=z9 plain=abcdefgh short=yes", [
      { value: "z9", type: "secret" },
      { value: "abcdefgh", type: "plain" },
      { value: "yes", type: "plain" },
    ]);
    expect(text).toBe("token=*** plain=*** short=yes");
  });

  it("replaces longer secrets before shorter overlapping ones", () => {
    const text = redactOutput("super-secret", [
      { value: "secret", type: "secret" },
      { value: "super-secret", type: "secret" },
    ]);
    expect(text).toBe("***");
  });
});
