import * as fs from "node:fs/promises";

const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 500;

export type ReadResult = {
  success: boolean;
  content: string;
  totalLines: number;
  linesReturned: number;
  offset: number;
  truncated: boolean;
  error?: string;
};

export type ReadOptions = {
  offset?: number;
  limit?: number;
};

export async function readFile(
  filePath: string,
  options: ReadOptions = {},
): Promise<ReadResult> {
  const offset = Math.max(0, options.offset ?? 0);
  const requestedLimit = options.limit ?? DEFAULT_LIMIT;
  const limit = Math.min(requestedLimit, MAX_LIMIT);

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    return {
      success: false, content: "", totalLines: 0, linesReturned: 0,
      offset, truncated: false,
      error: `Failed to read file: ${(err as Error).message}`,
    };
  }

  const allLines = raw.split("\n");
  const totalLines = allLines.length;
  const sliced = allLines.slice(offset, offset + limit);
  const numbered = sliced.map((line, i) => `${offset + i + 1}: ${line}`);

  return {
    success: true,
    content: numbered.join("\n"),
    totalLines,
    linesReturned: sliced.length,
    offset,
    truncated: requestedLimit > MAX_LIMIT,
  };
}
