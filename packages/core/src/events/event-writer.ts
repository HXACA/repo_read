import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AppEvent } from "../types/events.js";

export class EventWriter {
  constructor(private readonly filePath: string) {}

  async write(event: AppEvent): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const line = JSON.stringify(event) + "\n";
    await fs.appendFile(this.filePath, line, "utf-8");
  }
}
