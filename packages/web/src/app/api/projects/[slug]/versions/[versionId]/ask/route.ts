import { NextResponse } from "next/server";
import {
  StorageAdapter,
  AskService,
  loadProjectConfig,
  ProviderCenter,
  SecretStore,
  createModelForRole,
} from "@reporead/core";

function getStorage(): StorageAdapter {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  return new StorageAdapter(repoRoot);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; versionId: string }> },
): Promise<Response> {
  try {
    const { slug, versionId } = await params;
    const body = await request.json();
    const { question, currentPageSlug, sessionId } = body as {
      question: string;
      currentPageSlug?: string;
      sessionId?: string;
    };

    if (!question) {
      return NextResponse.json({ error: "Missing question" }, { status: 400 });
    }

    const storage = getStorage();
    const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();

    let config;
    try {
      config = await loadProjectConfig(storage.paths.projectDir(slug));
    } catch {
      return NextResponse.json({ error: "Project config not found" }, { status: 404 });
    }

    const providerCenter = new ProviderCenter();
    const resolvedConfig = providerCenter.resolve(config);

    const secretStore = new SecretStore({ backend: "env" });
    const apiKeys: Record<string, string> = {};
    for (const p of resolvedConfig.providers) {
      if (p.enabled) {
        const key = await secretStore.get(p.secretRef);
        if (key) apiKeys[p.provider] = key;
      }
    }

    const model = createModelForRole(resolvedConfig, "main.author", { apiKeys });
    const service = new AskService({ model, storage, repoRoot });

    const result = await service.ask(slug, versionId, question, {
      currentPageSlug,
      sessionId,
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
