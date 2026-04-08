import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AppError } from "../errors.js";
import { parseUserEditableConfig } from "./schema.js";
import type { UserEditableConfig } from "../types/config.js";

export const CONFIG_FILENAME = "project.json";

export async function loadProjectConfig(projectDir: string): Promise<UserEditableConfig> {
  const configPath = path.join(projectDir, CONFIG_FILENAME);

  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf-8");
  } catch {
    throw new AppError("CONFIG_NOT_FOUND", `Config not found at ${configPath}`, {
      path: configPath,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("CONFIG_INVALID", `Invalid JSON in ${configPath}`, {
      path: configPath,
    });
  }

  try {
    return parseUserEditableConfig(parsed);
  } catch (err) {
    throw new AppError("CONFIG_INVALID", `Config validation failed: ${String(err)}`, {
      path: configPath,
    });
  }
}

export async function saveProjectConfig(
  projectDir: string,
  config: UserEditableConfig,
): Promise<void> {
  await fs.mkdir(projectDir, { recursive: true });
  const configPath = path.join(projectDir, CONFIG_FILENAME);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}
