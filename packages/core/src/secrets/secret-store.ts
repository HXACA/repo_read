import { AppError } from "../errors.js";

export type SecretBackend = "keychain" | "env";

export interface SecretStoreOptions {
  backend: SecretBackend;
  service?: string;
}

const ENV_PREFIX = "REPOREAD_SECRET_";

export class SecretStore {
  readonly backendName: SecretBackend;
  private readonly service: string;

  constructor(options: SecretStoreOptions) {
    this.backendName = options.backend;
    this.service = options.service ?? "reporead";
  }

  async get(key: string): Promise<string | null> {
    if (this.backendName === "keychain") {
      return this.getFromKeychain(key);
    }
    return this.getFromEnv(key);
  }

  async set(key: string, value: string): Promise<void> {
    if (this.backendName === "keychain") {
      return this.setToKeychain(key, value);
    }
    throw new AppError(
      "SECRET_STORE_UNAVAILABLE",
      "Cannot write secrets in env-only mode. Set the environment variable manually.",
      { key },
    );
  }

  async delete(key: string): Promise<void> {
    if (this.backendName === "keychain") {
      return this.deleteFromKeychain(key);
    }
    throw new AppError(
      "SECRET_STORE_UNAVAILABLE",
      "Cannot delete secrets in env-only mode.",
      { key },
    );
  }

  private getFromEnv(key: string): string | null {
    // Check prefixed name first, then the raw key name (e.g. ANTHROPIC_API_KEY)
    return process.env[`${ENV_PREFIX}${key}`] ?? process.env[key] ?? null;
  }

  private async getFromKeychain(key: string): Promise<string | null> {
    try {
      // Dynamic import hidden from bundlers (Next.js can't resolve native 'keytar' module)
      const importDynamic = new Function("specifier", "return import(specifier)") as (s: string) => Promise<any>;
      const keytar = await importDynamic("keytar");
      const value = await keytar.getPassword(this.service, key);
      return value ?? null;
    } catch {
      return this.getFromEnv(key);
    }
  }

  private async setToKeychain(key: string, value: string): Promise<void> {
    try {
      // Dynamic import hidden from bundlers (Next.js can't resolve native 'keytar' module)
      const importDynamic = new Function("specifier", "return import(specifier)") as (s: string) => Promise<any>;
      const keytar = await importDynamic("keytar");
      await keytar.setPassword(this.service, key, value);
    } catch {
      throw new AppError(
        "SECRET_STORE_UNAVAILABLE",
        "System keychain not available. Use environment variables instead.",
        { key },
      );
    }
  }

  private async deleteFromKeychain(key: string): Promise<void> {
    try {
      // Dynamic import hidden from bundlers (Next.js can't resolve native 'keytar' module)
      const importDynamic = new Function("specifier", "return import(specifier)") as (s: string) => Promise<any>;
      const keytar = await importDynamic("keytar");
      await keytar.deletePassword(this.service, key);
    } catch {
      throw new AppError(
        "SECRET_STORE_UNAVAILABLE",
        "System keychain not available.",
        { key },
      );
    }
  }

  static mask(value: string): string {
    if (value.length <= 8) return "••••";
    const prefix = value.slice(0, 5);
    const suffix = value.slice(-4);
    return `${prefix}${"••••••••"}${suffix}`;
  }

  static async createDefault(): Promise<SecretStore> {
    try {
      // Dynamic import hidden from bundlers (Next.js can't resolve native 'keytar' module)
      const importDynamic = new Function("specifier", "return import(specifier)") as (s: string) => Promise<any>;
      await importDynamic("keytar");
      return new SecretStore({ backend: "keychain" });
    } catch {
      return new SecretStore({ backend: "env" });
    }
  }
}
