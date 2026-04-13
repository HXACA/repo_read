import { SSETimeoutError } from "./resilient-fetch.js";

export type ApiErrorKind =
  | "rate_limit"       // 429
  | "server_overload"  // 529, 503
  | "server_error"     // 500, 502
  | "context_overflow" // 400 + "prompt is too long" / "context_length_exceeded"
  | "auth_error"       // 401, 403
  | "bad_request"      // 400 other
  | "timeout"          // SSETimeoutError
  | "network_error"    // ECONNREFUSED, ECONNRESET, ETIMEDOUT, fetch failed
  | "unknown";

export type ApiErrorClassification = {
  kind: ApiErrorKind;
  retryable: boolean;
  retryAfterMs?: number;
};

const CONTEXT_OVERFLOW_PATTERNS = [
  "prompt is too long",
  "context_length_exceeded",
  "maximum context length",
];

type HeadersLike = Record<string, string> & { get?: (name: string) => string | null };

function parseRetryAfterMs(error: unknown): number | undefined {
  const headers = (error as unknown as { responseHeaders?: HeadersLike })?.responseHeaders;
  if (!headers) return undefined;

  // retry-after-ms takes precedence (milliseconds)
  const retryAfterMs =
    typeof headers["retry-after-ms"] === "string"
      ? Number(headers["retry-after-ms"])
      : typeof headers.get === "function"
        ? Number(headers.get("retry-after-ms") ?? "NaN")
        : NaN;

  if (!isNaN(retryAfterMs) && retryAfterMs > 0) return retryAfterMs;

  // retry-after (seconds, may be a date string or integer)
  const retryAfterRaw =
    typeof headers["retry-after"] === "string"
      ? headers["retry-after"]
      : typeof headers.get === "function"
        ? (headers.get("retry-after") ?? "")
        : "";

  if (retryAfterRaw) {
    const seconds = Number(retryAfterRaw);
    if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
  }

  return undefined;
}

function isContextOverflow(error: unknown): boolean {
  type ApiError = { responseBody?: unknown; message?: unknown };
  const apiErr = error as ApiError;
  const body: string =
    typeof apiErr?.responseBody === "string"
      ? apiErr.responseBody
      : typeof apiErr?.message === "string"
        ? apiErr.message
        : "";

  const lower = body.toLowerCase();
  return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => lower.includes(pattern));
}

export function classifyApiError(error: unknown): ApiErrorClassification {
  // SSETimeoutError
  if (error instanceof SSETimeoutError) {
    return { kind: "timeout", retryable: true };
  }

  const statusCode: number | undefined = (error as unknown as { statusCode?: number })?.statusCode;

  if (statusCode === 429) {
    return {
      kind: "rate_limit",
      retryable: true,
      retryAfterMs: parseRetryAfterMs(error),
    };
  }

  if (statusCode === 529 || statusCode === 503) {
    return {
      kind: "server_overload",
      retryable: true,
      retryAfterMs: parseRetryAfterMs(error),
    };
  }

  if (statusCode === 500 || statusCode === 502) {
    return { kind: "server_error", retryable: true };
  }

  if (statusCode === 401 || statusCode === 403) {
    return { kind: "auth_error", retryable: false };
  }

  if (statusCode === 400) {
    if (isContextOverflow(error)) {
      return { kind: "context_overflow", retryable: false };
    }
    return { kind: "bad_request", retryable: false };
  }

  // Network-level errors (no HTTP response — connection refused, reset, timeout, DNS failure)
  if (!statusCode && error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("econnrefused") || msg.includes("econnreset") ||
      msg.includes("etimedout") || msg.includes("fetch failed") ||
      msg.includes("network") || msg.includes("socket hang up") ||
      msg.includes("dns")
    ) {
      return { kind: "network_error", retryable: true };
    }
  }

  return { kind: "unknown", retryable: false };
}

export type RetryOptions = {
  maxRetries?: number;    // default 3
  baseDelayMs?: number;   // default 1000
  backoffFactor?: number; // default 2
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  const backoffFactor = options?.backoffFactor ?? 2;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const classification = classifyApiError(error);

      if (!classification.retryable) {
        throw error;
      }

      if (attempt >= maxRetries) {
        // Exhausted retries
        break;
      }

      const delayMs =
        classification.retryAfterMs ?? baseDelayMs * Math.pow(backoffFactor, attempt);

      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
