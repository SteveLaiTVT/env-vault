import { KEY_RE } from "../lib/types";

export const AI_SYSTEM_PROMPT = [
  "你是环境变量输出模板生成器。只输出模板文本，不要解释。",
  "占位符必须严格使用 {{vault:KEY}}。KEY 只能来自给定 key 名列表。",
  "禁止填入任何真实值，禁止猜测值，禁止回显样例中的具体内容。",
  "若样例里有具体值，只模仿结构，把值换成占位符。",
].join("\n");

export function buildAiRequest(input: { description?: string; sample?: string; keyNames: string[] }) {
  const keyNames = input.keyNames.map((key) => key.trim()).filter(Boolean);
  if (keyNames.length === 0 || keyNames.length > 200) {
    throw new Error("KEY_LIST");
  }
  if (keyNames.some((key) => !KEY_RE.test(key))) {
    throw new Error("KEY_LIST");
  }
  return {
    description: (input.description ?? "").slice(0, 2000),
    sample: (input.sample ?? "").slice(0, 4000),
    keyNames,
  };
}
