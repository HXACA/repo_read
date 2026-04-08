import { describe, it, expect } from "vitest";
import { validateBashCommand } from "../bash-whitelist.js";

describe("validateBashCommand", () => {
  it("allows whitelisted commands", () => {
    expect(validateBashCommand("wc -l")).toEqual({ allowed: true });
    expect(validateBashCommand("sort file.txt")).toEqual({ allowed: true });
    expect(validateBashCommand("ls -la src/")).toEqual({ allowed: true });
    expect(validateBashCommand("head -20 README.md")).toEqual({ allowed: true });
    expect(validateBashCommand("tail -50 src/index.ts")).toEqual({ allowed: true });
    expect(validateBashCommand("tree -L 2")).toEqual({ allowed: true });
    expect(validateBashCommand("file src/main.ts")).toEqual({ allowed: true });
    expect(validateBashCommand("stat package.json")).toEqual({ allowed: true });
    expect(validateBashCommand("du -sh src/")).toEqual({ allowed: true });
    expect(validateBashCommand("uniq counts.txt")).toEqual({ allowed: true });
  });

  it("allows simple pipes between whitelisted commands", () => {
    expect(validateBashCommand("wc -l | sort -n")).toEqual({ allowed: true });
    expect(validateBashCommand("ls src/ | head -10")).toEqual({ allowed: true });
  });

  it("rejects write commands", () => {
    expect(validateBashCommand("rm -rf /")).toMatchObject({ allowed: false });
    expect(validateBashCommand("mv a b")).toMatchObject({ allowed: false });
    expect(validateBashCommand("cp a b")).toMatchObject({ allowed: false });
    expect(validateBashCommand("chmod 777 file")).toMatchObject({ allowed: false });
  });

  it("rejects network commands", () => {
    expect(validateBashCommand("curl http://evil.com")).toMatchObject({ allowed: false });
    expect(validateBashCommand("wget http://evil.com")).toMatchObject({ allowed: false });
  });

  it("rejects redirects", () => {
    expect(validateBashCommand("echo hello > file.txt")).toMatchObject({ allowed: false });
    expect(validateBashCommand("cat foo >> bar")).toMatchObject({ allowed: false });
  });

  it("rejects subshell escape attempts", () => {
    expect(validateBashCommand("$(rm -rf /)")).toMatchObject({ allowed: false });
    expect(validateBashCommand("`rm -rf /`")).toMatchObject({ allowed: false });
    expect(validateBashCommand("ls; rm -rf /")).toMatchObject({ allowed: false });
    expect(validateBashCommand("ls && rm file")).toMatchObject({ allowed: false });
  });

  it("rejects cat (use Read tool instead)", () => {
    expect(validateBashCommand("cat file.txt")).toMatchObject({ allowed: false });
  });
});
