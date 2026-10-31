import { describe, expect, it } from "vitest";
import { builtinTemplate, fillTemplate, renderFormat } from "./format";

describe("renderFormat", () => {
  const entries = [
    { key: "NAME", value: "plain" },
    { key: "NOTE", value: "hello world" },
    { key: "Q", value: "a'b" },
  ];

  it("renders dotenv with quotes", () => {
    const text = renderFormat("dotenv", entries);
    expect(text).toContain("NAME=plain\n");
    expect(text).toContain('NOTE="hello world"\n');
  });

  it("renders shell exports", () => {
    expect(renderFormat("shell", [{ key: "Q", value: "a'b" }])).toBe("export Q='a'\\''b'\n");
  });

  it("renders json, yaml, and compose snippet", () => {
    expect(JSON.parse(renderFormat("json", entries)).NOTE).toBe("hello world");
    expect(renderFormat("yaml", [{ key: "NOTE", value: "hello world" }])).toContain('NOTE: "hello world"');
    const compose = renderFormat("compose", [{ key: "NOTE", value: "x" }]);
    expect(compose.startsWith("services:\n  app:\n    environment:\n")).toBe(true);
    expect(compose).toContain('NOTE: "x"');
    expect(compose).not.toContain("env_file");
  });
});

describe("templates", () => {
  it("fills placeholders and reports missing keys", () => {
    const filled = fillTemplate("A={{vault:FOO}}\nB={{vault:BAR}}\n", { FOO: "1" });
    expect(filled.text).toContain("A=1");
    expect(filled.missing).toEqual(["BAR"]);
  });

  it("base64-encodes kubernetes secret values on fill", () => {
    const tpl = builtinTemplate("k8s", ["TOKEN"]);
    expect(tpl.body).toContain("{{vault:TOKEN}}");
    const filled = fillTemplate(tpl.body, { TOKEN: "secret" }, { base64: true });
    expect(filled.text).toContain(btoa("secret"));
    expect(filled.text).not.toContain("secret");
  });

  it("builds github actions and systemd templates with placeholders only", () => {
    expect(builtinTemplate("gha", ["FOO"]).body).toContain('FOO: "{{vault:FOO}}"');
    expect(builtinTemplate("systemd", ["FOO"]).body).toContain("FOO={{vault:FOO}}");
  });
});
