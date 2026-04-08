/**
 * Robustly extract a JSON object from LLM output text.
 * Tries in order: code fence, raw JSON parse, brace extraction.
 */
export function extractJson(text: string): Record<string, unknown> | null {
  if (!text || text.trim().length === 0) return null;

  // 1. Try code fence
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // Continue to next strategy
    }
  }

  // 2. Try parsing the whole text as JSON
  try {
    const parsed = JSON.parse(text.trim());
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    // Continue
  }

  // 3. Find the first { ... } block (greedy)
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(text.slice(braceStart, braceEnd + 1));
    } catch {
      // Give up
    }
  }

  return null;
}
