import type { VarType } from "./types";

export type RedactItem = { value: string; type: VarType };

export function shouldRedact(item: RedactItem): boolean {
  if (!item.value) return false;
  if (item.type === "secret") return true;
  return item.value.length >= 8;
}

export function redactOutput(text: string, items: RedactItem[]): string {
  const needles = items
    .filter(shouldRedact)
    .map((item) => item.value)
    .sort((a, b) => b.length - a.length);
  let out = text;
  const seen = new Set<string>();
  for (const needle of needles) {
    if (seen.has(needle)) continue;
    seen.add(needle);
    out = out.split(needle).join("***");
  }
  return out;
}
