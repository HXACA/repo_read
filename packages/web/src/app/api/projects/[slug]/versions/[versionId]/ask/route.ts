import {
  StorageAdapter,
  AskStreamService,
  loadProjectConfig,
  ProviderCenter,
  resolveApiKeys,
  createModelForRole,
} from "@reporead/core";

function getStorage(): StorageAdapter {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  return new StorageAdapter(repoRoot);
}

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; versionId: string }> },
): Promise<Response> {
  const { slug, versionId } = await params;
  const body = await request.json();
  const { question, currentPageSlug, sessionId } = body as {
    question: string;
    currentPageSlug?: string;
    sessionId?: string;
  };

  if (!question) {
    return new Response(JSON.stringify({ error: "Missing question" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const storage = getStorage();
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();

  let config;
  try {
    config = await loadProjectConfig(storage.paths.projectDir(slug));
  } catch {
    return new Response(
      JSON.stringify({ error: "Project config not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const providerCenter = new ProviderCenter();
  const resolvedConfig = providerCenter.resolve(config);

  const apiKeys = resolveApiKeys(config);

  let model;
  try {
    model = createModelForRole(resolvedConfig, "main.author", { apiKeys });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const service = new AskStreamService({
    model,
    storage,
    repoRoot,
    language: resolvedConfig.language,
    qualityProfile: resolvedConfig.qualityProfile,
  });

  // Create SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of service.ask(slug, versionId, question, {
          currentPageSlug,
          sessionId,
        })) {
          controller.enqueue(encoder.encode(sseEvent(event)));
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            sseEvent({ type: "error", message: (err as Error).message }),
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
