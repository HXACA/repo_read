import { describe, it, expect, vi, afterEach } from "vitest";

// Mock child_process to avoid spawning a server
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(() => ({
      on: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      kill: vi.fn(),
      unref: vi.fn(),
    })),
  };
});

// Mock open to avoid launching a browser
vi.mock("open", () => ({ default: vi.fn() }));

describe("browse command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("module exports runBrowse function", async () => {
    const mod = await import("../../commands/browse.js");
    expect(typeof mod.runBrowse).toBe("function");
  });
});
