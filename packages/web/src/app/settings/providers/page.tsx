import Link from "next/link";
import { StorageAdapter, ProjectModel, ProviderCenter } from "@reporead/core";
import type { UserEditableConfig } from "@reporead/core";

async function getData() {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  const storage = new StorageAdapter(repoRoot);
  const projectModel = new ProjectModel(storage);
  const projects = await projectModel.list();

  const configs: Array<{ slug: string; config: UserEditableConfig | null; summary: string }> = [];
  const providerCenter = new ProviderCenter();

  for (const project of projects) {
    try {
      const config = await storage.readJson<UserEditableConfig>(
        `${storage.paths.projectDir(project.projectSlug)}/config.json`,
      );
      const summary = config ? providerCenter.summarize(config) : "No config";
      configs.push({ slug: project.projectSlug, config, summary });
    } catch {
      configs.push({ slug: project.projectSlug, config: null, summary: "Error loading config" });
    }
  }

  return configs;
}

export default async function ProvidersPage() {
  const configs = await getData();

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/" className="hover:text-blue-600">Home</Link>
        {" / "}
        <span>Settings / Providers</span>
      </nav>

      <h1 className="text-3xl font-bold">Provider Settings</h1>
      <p className="mt-2 text-gray-500 dark:text-gray-400">
        View and manage LLM provider configurations for each project.
      </p>

      {configs.length === 0 ? (
        <p className="mt-6 text-gray-400">No projects found.</p>
      ) : (
        <div className="mt-6 space-y-6">
          {configs.map(({ slug, config, summary }) => (
            <div
              key={slug}
              className="rounded-lg border border-gray-200 p-6 dark:border-gray-700"
            >
              <h2 className="text-lg font-semibold">{slug}</h2>
              {config ? (
                <>
                  <div className="mt-2 text-sm text-gray-500">
                    Preset: <span className="font-medium">{config.preset}</span>
                  </div>
                  <div className="mt-3">
                    <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">Providers</h3>
                    <ul className="mt-1 space-y-1">
                      {config.providers.map((p, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <span className={`h-2 w-2 rounded-full ${p.enabled ? "bg-green-500" : "bg-gray-300"}`} />
                          <span>{p.provider}</span>
                          <span className="text-gray-400">({p.secretRef})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-3">
                    <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">Role Routing</h3>
                    <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-3 text-xs dark:bg-gray-800">
                      {summary}
                    </pre>
                  </div>
                </>
              ) : (
                <p className="mt-2 text-sm text-gray-400">
                  No configuration found. Run{" "}
                  <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">repo-read init</code>{" "}
                  to set up.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="text-sm font-medium">Configuration via CLI</h3>
        <code className="mt-2 block rounded bg-gray-100 p-3 text-sm dark:bg-gray-800">
          repo-read providers
        </code>
        <p className="mt-2 text-xs text-gray-400">
          Edit <code>.reporead/projects/&lt;slug&gt;/config.json</code> directly or use the CLI.
        </p>
      </div>
    </main>
  );
}
