import { argon2id } from "hash-wasm";
import { b64ToBytes, bytesToB64, bytesToB64Url, b64UrlToBytes, randomBytes, sha256Hex, utf8 } from "./bytes";
import type { KdfParams } from "./types";

const ENC_INFO = "env-vault-enc-v1";
const AUTH_INFO = "env-vault-auth-v1";

function asView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new ArrayBuffer(bytes.byteLength);
  const view = new Uint8Array(copy);
  view.set(bytes);
  return view;
}

export type DerivedKeys = {
  encKey: CryptoKey;
  authKeyB64: string;
  masterRaw: Uint8Array;
};

export async function deriveKeys(password: string, saltB64: string, params: KdfParams): Promise<DerivedKeys> {
  const master = await argon2id({
    password,
    salt: b64ToBytes(saltB64),
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memory,
    hashLength: 32,
    outputType: "binary",
  });
  const masterRaw = new Uint8Array(master);
  const encKey = await hkdfKey(masterRaw, ENC_INFO);
  const authRaw = await hkdfBits(masterRaw, AUTH_INFO);
  return { encKey, authKeyB64: bytesToB64(authRaw), masterRaw };
}

async function importHkdf(master: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", asView(master), "HKDF", false, ["deriveBits"]);
}

async function hkdfBits(master: Uint8Array, info: string): Promise<Uint8Array> {
  const key = await importHkdf(master);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: asView(new Uint8Array(32)),
      info: asView(new TextEncoder().encode(info)),
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function hkdfKey(master: Uint8Array, info: string): Promise<CryptoKey> {
  const raw = await hkdfBits(master, info);
  return crypto.subtle.importKey("raw", asView(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function aesImportRaw(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", asView(raw), "AES-GCM", true, ["encrypt", "decrypt"]);
}

export async function aesEncrypt(key: CryptoKey, plaintext: string): Promise<{ cipher: string; iv: string }> {
  const iv = asView(randomBytes(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return { cipher: bytesToB64(new Uint8Array(ct)), iv: bytesToB64(iv) };
}

export async function aesDecrypt(key: CryptoKey, cipher: string, iv: string): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asView(b64ToBytes(iv)) },
    key,
    asView(b64ToBytes(cipher)),
  );
  return utf8(new Uint8Array(pt));
}

export async function generateDek(): Promise<{ raw: Uint8Array; key: CryptoKey }> {
  const raw = randomBytes(32);
  return { raw, key: await aesImportRaw(raw) };
}

export async function wrapDek(encKey: CryptoKey, dekRaw: Uint8Array): Promise<{ wrappedDek: string; dekIv: string }> {
  const iv = asView(randomBytes(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, encKey, asView(dekRaw));
  return { wrappedDek: bytesToB64(new Uint8Array(ct)), dekIv: bytesToB64(iv) };
}

export async function unwrapDek(encKey: CryptoKey, wrappedDek: string, dekIv: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asView(b64ToBytes(dekIv)) },
    encKey,
    asView(b64ToBytes(wrappedDek)),
  );
  return aesImportRaw(new Uint8Array(raw));
}

export function newKdfSalt(): string {
  return bytesToB64(randomBytes(16));
}

export async function hashAuthKey(authKeyB64: string, saltB64: string, params: KdfParams): Promise<string> {
  const hash = await argon2id({
    password: authKeyB64,
    salt: b64ToBytes(saltB64),
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memory,
    hashLength: 32,
    outputType: "hex",
  });
  return hash;
}

export type RsaPair = {
  publicSpkiB64: string;
  privatePkcs8B64Url: string;
};

export async function generateRsaWrapPair(): Promise<RsaPair> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: asView(new Uint8Array([1, 0, 1])),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"],
  );
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  return {
    publicSpkiB64: bytesToB64(new Uint8Array(spki)),
    privatePkcs8B64Url: bytesToB64Url(new Uint8Array(pkcs8)),
  };
}

export async function rsaWrapDek(publicSpkiB64: string, dekRaw: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "spki",
    asView(b64ToBytes(publicSpkiB64)),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, asView(dekRaw));
  return bytesToB64(new Uint8Array(wrapped));
}

export async function rsaUnwrapDek(privatePkcs8B64Url: string, wrappedDekB64: string): Promise<CryptoKey> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    asView(b64UrlToBytes(privatePkcs8B64Url)),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
  const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, key, asView(b64ToBytes(wrappedDekB64)));
  return aesImportRaw(new Uint8Array(raw));
}

export async function exportDekRaw(key: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return new Uint8Array(raw);
}

export function buildTokenString(publicId: string, authSecretB64Url: string, privatePkcs8B64Url: string): string {
  return `ev1.${publicId}.${authSecretB64Url}.${privatePkcs8B64Url}`;
}

export function parseTokenString(token: string): { publicId: string; authSecret: string; pkcs8: string } | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "ev1") return null;
  if (!parts[1] || !parts[2] || !parts[3]) return null;
  return { publicId: parts[1], authSecret: parts[2], pkcs8: parts[3] };
}

export async function newAuthSecret(): Promise<{ secretB64Url: string; hash: string }> {
  const secret = randomBytes(32);
  const secretB64Url = bytesToB64Url(secret);
  return { secretB64Url, hash: await sha256Hex(secretB64Url) };
}

export async function encryptOptional(
  key: CryptoKey,
  text: string,
): Promise<{ cipher: string | null; iv: string | null }> {
  if (!text) return { cipher: null, iv: null };
  const enc = await aesEncrypt(key, text);
  return { cipher: enc.cipher, iv: enc.iv };
}

export async function decryptOptional(key: CryptoKey, cipher: string | null, iv: string | null): Promise<string> {
  if (!cipher || !iv) return "";
  return aesDecrypt(key, cipher, iv);
}
