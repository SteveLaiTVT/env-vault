import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aesEncrypt, buildTokenString, generateDek, generateRsaWrapPair, newAuthSecret, rsaWrapDek } from "../src/lib/crypto";
import { decryptMaterial, renderToFile } from "./engine";
import type { AgentMaterial } from "../src/lib/token-policy";

describe("cli engine", () => {
  it("decrypts wrapped material locally and writes a file without returning values", async () => {
    const { raw, key } = await generateDek();
    const pair = await generateRsaWrapPair();
    const auth = await newAuthSecret();
    const token = buildTokenString("11111111-1111-1111-1111-111111111111", auth.secretB64Url, pair.privatePkcs8B64Url);
    const secret = await aesEncrypt(key, "super-secret-value");
    const material: AgentMaterial = {
      op: "replace",
      scopeType: "public",
      scopeId: null,
      wrappedDek: await rsaWrapDek(pair.publicSpkiB64, raw),
      publicKeySpki: pair.publicSpkiB64,
      serverOrder: [],
      variables: [{
        id: "v1",
        key: "TOKEN",
        scopeType: "public",
        scopeId: null,
        scopeName: "公共",
        type: "secret",
        valueCipher: secret.cipher,
        valueIv: secret.iv,
        noteCipher: null,
        noteIv: null,
        updatedAt: "2024-01-01T00:00:00.000Z",
      }],
    };
    const rows = await decryptMaterial(token, material);
    expect(rows[0]?.value).toBe("super-secret-value");
    const dir = mkdtempSync(join(tmpdir(), "env-vault-"));
    const template = join(dir, "t.txt");
    const out = join(dir, "out.txt");
    writeFileSync(template, "TOKEN={{vault:TOKEN}}\nMISSING={{vault:OTHER}}\n");
    const missing = await renderToFile(template, out, rows);
    expect(missing.ok).toBe(false);
    expect(missing.missing).toEqual(["OTHER"]);
    writeFileSync(template, "TOKEN={{vault:TOKEN}}\n");
    const ok = await renderToFile(template, out, rows);
    expect(ok.ok).toBe(true);
    expect(readFileSync(out, "utf8")).toContain("super-secret-value");
  });
});
