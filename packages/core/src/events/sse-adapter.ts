import type { AppEvent } from "../types/events.js";
import { EventReader } from "./event-reader.js";

/**
 * Converts an ndjson event file into an async iterable of SSE-formatted strings.
 * Supports resuming from a specific event ID (sinceEventId).
 * Designed for use with Web ReadableStream or Node.js response streaming.
 */
export function createSSEStream(
  eventsPath: string,
  sinceEventId?: string,
): ReadableStream<string> {
  const reader = new EventReader(eventsPath);

  return new ReadableStream<string>({
    async start(controller) {
      const events = sinceEventId
        ? await reader.readSince(sinceEventId)
        : await reader.readAll();

      for (const event of events) {
        controller.enqueue(formatSSE(event));
      }
      controller.close();
    },
  });
}

export function formatSSE(event: AppEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
