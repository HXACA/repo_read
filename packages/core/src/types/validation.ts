export type ValidationTarget = "wiki" | "page";

export type ValidationReport = {
  target: ValidationTarget;
  passed: boolean;
  errors: string[];
  warnings: string[];
};
