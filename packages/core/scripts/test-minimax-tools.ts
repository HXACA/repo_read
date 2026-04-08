/**
 * Verify: inputSchema fix — tool call params should now be correct
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, jsonSchema, stepCountIs } from "ai";

const apiKey = process.env.MINIMAX_API_KEY!;

const originalFetch = globalThis.fetch;
globalThis.fetch = async function(input: any, init?: any) {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('minimaxi.com') && init?.body) {
    const body = JSON.parse(init.body);
    if (body.tools) {
      console.log(">>> Sent input_schema:", JSON.stringify(body.tools[0]?.input_schema));
    }
  }
  const resp = await originalFetch(input, init);
  if (url.includes('minimaxi.com')) {
    const clone = resp.clone();
    const data = await clone.json();
    const toolUse = data.content?.find((c: any) => c.type === 'tool_use');
    if (toolUse) {
      console.log("<<< Received tool input:", JSON.stringify(toolUse.input));
    }
  }
  return resp;
} as typeof fetch;

const anthropic = createAnthropic({
  authToken: apiKey,
  baseURL: "https://api.minimaxi.com/anthropic/v1",
});
const model = anthropic("MiniMax-M2.7-highspeed");

async function main() {
  const result = await generateText({
    model,
    prompt: "What is 2 + 3? Use the calculator tool.",
    stopWhen: stepCountIs(5),
    tools: {
      calculator: {
        description: "Add two numbers",
        inputSchema: jsonSchema<{ a: number; b: number }>({
          type: "object",
          properties: {
            a: { type: "number", description: "First number" },
            b: { type: "number", description: "Second number" },
          },
          required: ["a", "b"],
        }),
        execute: async (params: { a: number; b: number }) => {
          console.log(">>> EXECUTE:", JSON.stringify(params));
          return String(params.a + params.b);
        },
      },
    },
  });

  console.log("\nFINAL text:", result.text?.slice(0, 200));
  console.log("FINAL steps:", result.steps.length);
}

main().catch(console.error);
