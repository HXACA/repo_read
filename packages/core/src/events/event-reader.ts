import * as fs from "node:fs/promises";
import type { AppEvent } from "../types/events.js";

export class EventReader {
  constructor(private readonly filePath: string) {}

  async readAll(): Promise<AppEvent[]> {
    let content: string;
    try {
      content = await fs.readFile(this.filePath, "utf-8");
    } catch {
      return [];
    }

    return content
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as AppEvent);
  }

  async readSince(afterEventId: string): Promise<AppEvent[]> {
    const all = await this.readAll();
    const idx = all.findIndex((e) => e.id === afterEventId);
    if (idx === -1) return all;
    return all.slice(idx + 1);
  }
}
