const DEFAULT_SSE_TIMEOUT_MS = 120_000; // 2 minutes

export class SSETimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`SSE stream stalled: no data received for ${timeoutMs}ms`);
    this.name = "SSETimeoutError";
  }
}

export function createResilientFetch(
  baseFetch: typeof globalThis.fetch,
  options?: { sseReadTimeoutMs?: number },
): typeof globalThis.fetch {
  const timeoutMs = options?.sseReadTimeoutMs ?? DEFAULT_SSE_TIMEOUT_MS;

  return async (input, init) => {
    const response = await baseFetch(input, init);
    const contentType = response.headers.get("content-type") ?? "";
    const isStreaming =
      contentType.includes("text/event-stream") || contentType.includes("application/x-ndjson");

    if (!isStreaming || !response.body) {
      return response;
    }

    const reader = response.body.getReader();
    const wrappedBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        // Use a manual race to avoid PromiseRejectionHandledWarning from
        // Promise.race when fake timers fire the timeout synchronously.
        const result = await new Promise<Awaited<ReturnType<typeof reader.read>>>(
          (resolve, reject) => {
            const timerId = setTimeout(
              () => reject(new SSETimeoutError(timeoutMs)),
              timeoutMs,
            );
            reader.read().then(
              (r) => { clearTimeout(timerId); resolve(r); },
              (e) => { clearTimeout(timerId); reject(e); },
            );
          },
        );

        if (result.done) {
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      },
      cancel() {
        reader.cancel();
      },
    });

    return new Response(wrappedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
