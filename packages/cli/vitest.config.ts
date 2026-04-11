import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Force all "ai" imports (including from @reporead/core's compiled
      // dist code) to resolve to the same physical module entry. Without
      // this, pnpm hoisting puts `ai` under packages/core/node_modules
      // and vi.mock("ai") only patches the CLI's resolution scope — not
      // the one @reporead/core uses internally.
      ai: path.resolve(__dirname, "../core/node_modules/ai"),
    },
  },
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    globals: true,
  },
});
