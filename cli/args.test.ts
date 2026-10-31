import { describe, expect, it } from "vitest";
import { detectShell, parseArgs } from "./args";

describe("parseArgs", () => {
  it("parses render flags and run separator", () => {
    expect(parseArgs(["render", "--token", "ev1.a.b.c", "--template", "t.txt", "--out", "out.env"], {})).toMatchObject({
      cmd: "render",
      templatePath: "t.txt",
      outPath: "out.env",
    });
    expect(parseArgs(["run", "--token", "ev1.a.b.c", "--", "npm", "test"], {})).toMatchObject({
      cmd: "run",
      command: ["npm", "test"],
    });
  });

  it("refuses render without files and does not echo the token", () => {
    expect(() => parseArgs(["render", "--token", "ev1.secret"], {})).toThrow(/template/);
  });

  it("detects the shell and parses the shell command", () => {
    expect(detectShell({})).toBe("bash");
    expect(detectShell({ SHELL: "/bin/zsh" })).toBe("zsh");
    expect(detectShell({ SHELL: "/usr/bin/fish" })).toBe("fish");
    expect(detectShell({ PSModulePath: "C:\\Modules" })).toBe("powershell");
    expect(detectShell({ ComSpec: "C:\\Windows\\system32\\cmd.exe" })).toBe("cmd");
    expect(detectShell({ SHELL: "/bin/bash", PSModulePath: "x" })).toBe("bash");
    expect(parseArgs(["shell", "--token", "ev1.a.b.c", "--shell", "fish"], {})).toMatchObject({ cmd: "shell", shell: "fish" });
  });
});
