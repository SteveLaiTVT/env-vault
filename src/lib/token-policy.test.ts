import { describe, expect, it } from "vitest";
import {
  assertTokenOp,
  buildAgentMaterial,
  plaintextForbiddenResponse,
  PolicyError,
  sanitizeAuditMeta,
} from "./token-policy";

const base = {
  canInject: true,
  canReplace: false,
  expiresAt: "2099-01-01T00:00:00.000Z",
  revokedAt: null,
};

describe("token policy", () => {
  it("rejects plaintext endpoints unconditionally", () => {
    const res = plaintextForbiddenResponse();
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("PLAINTEXT_FORBIDDEN");
    expect(JSON.stringify(res.body)).not.toMatch(/secret/i);
  });

  it("rejects a token calling an operation it was not granted", () => {
    expect(() => assertTokenOp(base, "inject")).not.toThrow();
    expect(() => assertTokenOp(base, "replace")).toThrow(PolicyError);
    expect(() => assertTokenOp({ ...base, revokedAt: "2020-01-01T00:00:00.000Z" }, "inject")).toThrow(/吊销/);
    expect(() => assertTokenOp({ ...base, expiresAt: "2000-01-01T00:00:00.000Z" }, "inject")).toThrow(/过期/);
  });

  it("agent material cannot carry a plaintext value field", () => {
    const material = buildAgentMaterial({
      op: "inject",
      scopeType: "server",
      scopeId: "s1",
      wrappedDek: "wrap",
      publicKeySpki: "pk",
      serverOrder: [],
      variables: [
        {
          id: "v1",
          key: "TOKEN",
          scopeType: "server",
          scopeId: "s1",
          scopeName: "web",
          type: "secret",
          valueCipher: "cipher",
          valueIv: "iv",
          noteCipher: null,
          noteIv: null,
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(material)).not.toContain("plaintext");
    expect(material.variables[0]?.key).toBe("TOKEN");
    expect("value" in (material.variables[0] ?? {})).toBe(false);
  });

  it("drops secret-bearing audit meta", () => {
    const meta = sanitizeAuditMeta({
      format: "dotenv",
      count: 2,
      value: "super-secret",
      missingKeys: ["TOKEN"],
      note: "password=1",
    });
    expect(meta).toEqual({ format: "dotenv", count: 2, missingKeys: ["TOKEN"] });
  });
});
