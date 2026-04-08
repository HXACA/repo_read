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

  it("has generate command registered", () => {
    const program = createProgram();
    const genCmd = program.commands.find((c) => c.name() === "generate");
    expect(genCmd).toBeDefined();
  });

  it("has browse command registered", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "browse");
    expect(cmd).toBeDefined();
  });

  it("has jobs command registered", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "jobs");
    expect(cmd).toBeDefined();
  });

  it("has versions command registered", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "versions");
    expect(cmd).toBeDefined();
  });

  it("has ask command registered", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "ask");
    expect(cmd).toBeDefined();
  });
});
