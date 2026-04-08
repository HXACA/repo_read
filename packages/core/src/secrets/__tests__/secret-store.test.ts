import { describe, it, expect, beforeEach } from "vitest";
import { SecretStore } from "../secret-store.js";

describe("SecretStore", () => {
  describe("env fallback mode", () => {
    let store: SecretStore;

    beforeEach(() => {
      store = new SecretStore({ backend: "env" });
    });

    it("reads from environment variables", async () => {
      process.env["REPOREAD_SECRET_test_key"] = "secret-value";
      const value = await store.get("test_key");
      expect(value).toBe("secret-value");
      delete process.env["REPOREAD_SECRET_test_key"];
    });

    it("returns null for missing secret", async () => {
      const value = await store.get("nonexistent");
      expect(value).toBeNull();
    });

    it("masks secret values", () => {
      expect(SecretStore.mask("sk-1234567890abcdef")).toBe("sk-12••••••••cdef");
    });

    it("masks short values completely", () => {
      expect(SecretStore.mask("abc")).toBe("••••");
    });
  });

  describe("backend detection", () => {
    it("creates store with env backend", () => {
      const store = new SecretStore({ backend: "env" });
      expect(store.backendName).toBe("env");
    });
  });
});
