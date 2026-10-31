import { aesDecrypt, aesEncrypt, decryptOptional, encryptOptional } from "./crypto";
import type { DecryptedVar, StoredVar } from "./model";
import { CANARY } from "./model";

export async function sealCanary(dek: CryptoKey) {
  return aesEncrypt(dek, CANARY);
}

export async function canaryMatches(dek: CryptoKey, cipher: string, iv: string) {
  try {
    return (await aesDecrypt(dek, cipher, iv)) === CANARY;
  } catch {
    return false;
  }
}

export async function openStored(dek: CryptoKey, row: StoredVar): Promise<DecryptedVar> {
  return {
    ...row,
    value: await aesDecrypt(dek, row.valueCipher, row.valueIv),
    note: await decryptOptional(dek, row.noteCipher, row.noteIv),
  };
}

export async function sealStored(
  dek: CryptoKey,
  row: Omit<StoredVar, "valueCipher" | "valueIv" | "noteCipher" | "noteIv"> & { value: string; note: string },
): Promise<StoredVar> {
  const value = await aesEncrypt(dek, row.value);
  const note = await encryptOptional(dek, row.note);
  return {
    id: row.id,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    key: row.key,
    type: row.type,
    valueCipher: value.cipher,
    valueIv: value.iv,
    noteCipher: note.cipher,
    noteIv: note.iv,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  };
}
