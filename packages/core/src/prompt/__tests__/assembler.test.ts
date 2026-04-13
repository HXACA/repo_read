import { describe, it, expect } from "vitest";
import { PromptAssembler } from "../assembler.js";
import type { PromptAssemblyInput } from "../types.js";

describe("PromptAssembler", () => {
  const assembler = new PromptAssembler();

  it("passes system prompt through unchanged", () => {
    const input: PromptAssemblyInput = {
      role: "drafter",
      language: "en",
      systemPrompt: "You are a helpful assistant.",
      userPrompt: "Write a wiki page.",
    };
    const result = assembler.assemble(input);
    expect(result.system).toBe(input.systemPrompt);
  });

  it("passes user prompt through unchanged", () => {
    const input: PromptAssemblyInput = {
      role: "reviewer",
      language: "fr",
      systemPrompt: "Review the following.",
      userPrompt: "Check citations.",
    };
    const result = assembler.assemble(input);
    expect(result.user).toBe(input.userPrompt);
  });

  it("preserves role and language", () => {
    const input: PromptAssemblyInput = {
      role: "catalog",
      language: "ja",
      systemPrompt: "sys",
      userPrompt: "usr",
    };
    const result = assembler.assemble(input);
    expect(result.role).toBe("catalog");
    expect(result.language).toBe("ja");
  });

  it("sections metadata is all empty arrays (phase 0 passthrough)", () => {
    const input: PromptAssemblyInput = {
      role: "outline",
      language: "en",
      systemPrompt: "sys",
      userPrompt: "usr",
    };
    const result = assembler.assemble(input);
    expect(result.sections.base).toEqual([]);
    expect(result.sections.developer).toEqual([]);
    expect(result.sections.contextualUser).toEqual([]);
    expect(result.sections.roleSpecific).toEqual([]);
  });
});
