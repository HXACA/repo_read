import { StorageAdapter, createSSEStream } from "@reporead/core";

function getStorage(): StorageAdapter {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  return new StorageAdapter(repoRoot);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; jobId: string }> },
): Promise<Response> {
  const { slug, jobId } = await params;
  const storage = getStorage();
  const url = new URL(request.url);
  const sinceEventId = url.searchParams.get("since") ?? undefined;

  const eventsPath = storage.paths.eventsNdjson(slug, jobId);
  const sseStream = createSSEStream(eventsPath, sinceEventId);

  // Convert string ReadableStream to Uint8Array ReadableStream
  const encoder = new TextEncoder();
  const byteStream = sseStream.pipeThrough(
    new TransformStream<string, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(encoder.encode(chunk));
      },
    }),
  );

  return new Response(byteStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
