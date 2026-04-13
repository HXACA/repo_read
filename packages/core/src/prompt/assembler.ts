import type { AssembledPrompt, PromptAssemblyInput } from "./types.js";

export class PromptAssembler {
  assemble(input: PromptAssemblyInput): AssembledPrompt {
    return {
      role: input.role,
      language: input.language,
      system: input.systemPrompt,
      user: input.userPrompt,
      sections: { base: [], developer: [], contextualUser: [], roleSpecific: [] },
    };
  }
}
