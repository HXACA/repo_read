export type ToolResult<T = unknown> = {
  tool: string;
  success: boolean;
  data?: T;
  error?: string;
};
