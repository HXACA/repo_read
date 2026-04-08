import { randomUUID } from "node:crypto";
import type { AppEvent, EventChannel } from "../types/events.js";

export function createAppEvent<T = unknown>(
  channel: EventChannel,
  type: string,
  projectId: string,
  payload: T,
  extra?: Partial<Pick<AppEvent, "jobId" | "versionId" | "pageSlug" | "sessionId">>,
): AppEvent<T> {
  return {
    id: randomUUID(),
    channel,
    type,
    at: new Date().toISOString(),
    projectId,
    ...extra,
    payload,
  };
}
