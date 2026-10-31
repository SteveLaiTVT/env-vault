import { NextResponse } from "next/server";
import { AI_SYSTEM_PROMPT, buildAiRequest } from "../../../../server/ai";
import { requireUser } from "../../../../server/guard";
import { jsonError, toErrorResponse } from "../../../../server/http";
import { aiSchema, readJson } from "../../../../server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) return jsonError("AI_UNAVAILABLE", "未配置 DEEPSEEK_API_KEY，请改用内置模板", 503);
    const body = await readJson(req, aiSchema);
    let payload;
    try {
      payload = buildAiRequest(body);
    } catch {
      return jsonError("BAD_REQUEST", "key 名不合法", 400);
    }
    const base = (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/$/, "");
    const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: AI_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });
    if (!response.ok) return jsonError("AI_FAILED", "模型调用失败", 502);
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const template = data.choices?.[0]?.message?.content?.slice(0, 20000) ?? "";
    if (!template.trim()) return jsonError("AI_FAILED", "模型没有返回模板", 502);
    return NextResponse.json({ template });
  } catch (err) {
    return toErrorResponse(err);
  }
}
