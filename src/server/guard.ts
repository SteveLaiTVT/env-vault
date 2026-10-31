import { cookies } from "next/headers";
import { sha256Hex } from "../lib/bytes";
import { SESSION_MS } from "../lib/types";
import { getDb, type AppDb } from "./db";
import { cloudUnavailable, jsonError } from "./http";
import { userFromTokenHash, type UserRow } from "./service";

export const SESSION_COOKIE = "ev_session";

export async function requireDb(): Promise<{ db: AppDb } | { error: Response }> {
  const db = getDb();
  if (!db) return { error: cloudUnavailable() };
  return { db };
}

export async function requireUser(): Promise<{ db: AppDb; user: UserRow } | { error: Response }> {
  const got = await requireDb();
  if ("error" in got) return got;
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return { error: jsonError("UNAUTHORIZED", "未登录", 401) };
  const user = await userFromTokenHash(got.db, await sha256Hex(token));
  if (!user) return { error: jsonError("UNAUTHORIZED", "未登录", 401) };
  return { db: got.db, user };
}

export async function writeSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_MS / 1000),
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

export async function sessionTokenHash(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return sha256Hex(token);
}
