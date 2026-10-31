import { describe, expect, it } from "vitest";
import { GET as valuesGet, POST as valuesPost } from "./agent/values/route";
import { GET as agentPlainGet } from "./agent/plaintext/route";
import { POST as exportPost } from "./export/plaintext/route";
import { GET as varPlainGet } from "./variables/[id]/plaintext/route";
import { GET as healthGet } from "./health/route";
import { AI_SYSTEM_PROMPT, buildAiRequest } from "../../server/ai";

describe("plaintext routes", () => {
  it("rejects machine and user plaintext endpoints", async () => {
    for (const res of [valuesGet(), valuesPost(), agentPlainGet(), exportPost(), varPlainGet()]) {
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("PLAINTEXT_FORBIDDEN");
      expect(JSON.stringify(body)).not.toContain("value");
    }
  });

  it("health does not report a connection string", async () => {
    const body = await healthGet().json();
    expect(body.ok).toBe(true);
    expect(JSON.stringify(body)).not.toContain("postgres");
  });
});

describe("ai payload", () => {
  it("sends only description, sample, and key names", () => {
    const payload = buildAiRequest({ description: "yaml", sample: "FOO: 1", keyNames: ["FOO"] });
    expect(Object.keys(payload).sort()).toEqual(["description", "keyNames", "sample"]);
    expect(AI_SYSTEM_PROMPT).toContain("{{vault:KEY}}");
    expect(() => buildAiRequest({ description: "", sample: "", keyNames: ["bad-key"] })).toThrow();
  });
});
