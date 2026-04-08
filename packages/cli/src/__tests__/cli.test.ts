import { describe, it, expect } from "vitest";
import { createProgram } from "../cli.js";

describe("CLI program", () => {
  it("creates a Commander program with name repo-read", () => {
    const program = createProgram();
    expect(program.name()).toBe("repo-read");
  });

  it("has version defined", () => {
    const program = createProgram();
    expect(program.version()).toBeDefined();
  });

  it("has init command registered", () => {
    const program = createProgram();
    const initCmd = program.commands.find((c) => c.name() === "init");
    expect(initCmd).toBeDefined();
  });
});
