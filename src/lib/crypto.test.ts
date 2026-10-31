import { describe, expect, it } from "vitest";
import {
  aesDecrypt,
  aesEncrypt,
  deriveKeys,
  generateDek,
  generateRsaWrapPair,
  newKdfSalt,
  parseTokenString,
  rsaUnwrapDek,
  rsaWrapDek,
  unwrapDek,
  wrapDek,
  buildTokenString,
  exportDekRaw,
} from "./crypto";
import { aesEncrypt as enc } from "./crypto";

const testKdf = { memory: 32, iterations: 1, parallelism: 1 };

describe("crypto roundtrip", () => {
  it("splits password into distinct keys and never needs the raw password to decrypt", async () => {
    const salt = newKdfSalt();
    const derived = await deriveKeys("correct horse", salt, testKdf);
    const again = await deriveKeys("correct horse", salt, testKdf);
    expect(derived.authKeyB64).toBe(again.authKeyB64);
    const other = await deriveKeys("wrong horse!!", salt, testKdf);
    expect(other.authKeyB64).not.toBe(derived.authKeyB64);

    const { raw, key } = await generateDek();
    const wrapped = await wrapDek(derived.encKey, raw);
    const dek = await unwrapDek(derived.encKey, wrapped.wrappedDek, wrapped.dekIv);
    const secret = await aesEncrypt(key, "top-secret");
    expect(await aesDecrypt(dek, secret.cipher, secret.iv)).toBe("top-secret");
    await expect(aesDecrypt(dek, secret.cipher, secret.iv + "x")).rejects.toThrow();
  });

  it("wraps the DEK to a token public key and unwraps only with the private key", async () => {
    const { raw, key } = await generateDek();
    const pair = await generateRsaWrapPair();
    const wrapped = await rsaWrapDek(pair.publicSpkiB64, raw);
    const opened = await rsaUnwrapDek(pair.privatePkcs8B64Url, wrapped);
    const blob = await enc(key, "agent-value");
    expect(await aesDecrypt(opened, blob.cipher, blob.iv)).toBe("agent-value");
    const token = buildTokenString("pubid", "secret", pair.privatePkcs8B64Url);
    expect(parseTokenString(token)?.pkcs8).toBe(pair.privatePkcs8B64Url);
    expect(await exportDekRaw(opened)).toEqual(raw);
  });
});
