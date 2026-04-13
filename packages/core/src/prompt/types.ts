export type PromptRole = "catalog" | "outline" | "drafter" | "worker" | "reviewer" | "ask" | "research";

export type PromptAssemblyInput = {
  role: PromptRole;
  language: string;
  systemPrompt: string;
  userPrompt: string;
};

export type AssembledPrompt = {
  role: PromptRole;
  language: string;
  system: string;
  user: string;
  sections: {
    base: string[];
    developer: string[];
    contextualUser: string[];
    roleSpecific: string[];
  };
};
