import { StorageAdapter, ProjectModel } from "@reporead/core";
import type { WikiJson, VersionJson } from "@reporead/core";
import { notFound } from "next/navigation";
import { VersionClient } from "./version-client";

async function getVersionData(slug: string, versionId: string) {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  const storage = new StorageAdapter(repoRoot);
  const projectModel = new ProjectModel(storage);

  const wiki = await storage.readJson<WikiJson>(
    storage.paths.versionWikiJson(slug, versionId),
  );
  const version = await storage.readJson<VersionJson>(
    storage.paths.versionJson(slug, versionId),
  );
  const allVersions = await projectModel.listVersions(slug);
  const project = await projectModel.get(slug);
  const latestVersionId = project?.latestVersionId;

  return { wiki, version, allVersions, latestVersionId };
}

export default async function VersionPage({
  params,
}: {
  params: Promise<{ slug: string; versionId: string }>;
}) {
  const { slug, versionId } = await params;
  const { wiki, version, allVersions, latestVersionId } = await getVersionData(
    slug,
    versionId,
  );

  if (!wiki) notFound();

  return (
    <VersionClient
      slug={slug}
      versionId={versionId}
      wiki={wiki}
      version={version}
      allVersions={allVersions}
      latestVersionId={latestVersionId}
    />
  );
}
