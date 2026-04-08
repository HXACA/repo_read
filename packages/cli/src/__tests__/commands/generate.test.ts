import { describe, it, expect } from "vitest";
import { createProgram } from "../../cli.js";

describe("generate command", () => {
  it("is registered on the program", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "generate");
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain("wiki");
  });

  it("has --dir and --name options", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "generate");
    const opts = cmd!.options.map((o) => o.long);
    expect(opts).toContain("--dir");
    expect(opts).toContain("--name");
  });
});
