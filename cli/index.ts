import { renderFormat } from "../src/lib/format";
import type { OutputFormat } from "../src/lib/types";
import { parseArgs } from "./args";
import { decryptMaterial, loadMaterial, renderToFile, runWithEnv } from "./engine";

function shellFormat(shell: string): OutputFormat {
  if (shell === "fish" || shell === "powershell" || shell === "cmd") return shell;
  return "bash";
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.cmd === "shell") {
    const material = await loadMaterial(parsed.api, parsed.token, "inject");
    const rows = await decryptMaterial(parsed.token, material);
    process.stdout.write(renderFormat(shellFormat(parsed.shell), rows.map((row) => ({ key: row.key, value: row.value }))));
    return;
  }
  if (parsed.cmd === "render") {
    const material = await loadMaterial(parsed.api, parsed.token, "replace");
    const rows = await decryptMaterial(parsed.token, material);
    const result = await renderToFile(parsed.templatePath, parsed.outPath, rows);
    if (!result.ok) {
      console.error("missing");
      for (const key of result.missing) console.error(key);
      process.exit(2);
    }
    console.log("ok");
    console.log(`wrote ${parsed.outPath}`);
    return;
  }
  const material = await loadMaterial(parsed.api, parsed.token, "inject");
  const rows = await decryptMaterial(parsed.token, material);
  const code = await runWithEnv(parsed.command, rows);
  process.exit(code);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "命令失败";
  console.error(message.includes("=") ? "命令失败" : message);
  process.exit(1);
});
