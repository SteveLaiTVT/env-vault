import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { plaintextForbiddenResponse } from "../lib/token-policy";

export function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ error: code, message }, { status });
}

export function cloudUnavailable() {
  return jsonError("CLOUD_UNAVAILABLE", "未配置 DATABASE_URL，仅本地模式可用", 503);
}

export function forbiddenPlaintext() {
  const res = plaintextForbiddenResponse();
  return NextResponse.json(res.body, { status: res.status });
}

export function zodError() {
  return jsonError("BAD_REQUEST", "请求不合法", 400);
}

export function toErrorResponse(err: unknown) {
  if (err instanceof ZodError) return zodError();
  if (err instanceof Error && "status" in err && "code" in err) {
    const coded = err as Error & { status: number; code: string };
    return jsonError(coded.code, coded.message || "请求失败", coded.status);
  }
  console.error("api_error");
  return jsonError("INTERNAL", "服务暂时不可用", 500);
}

export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
