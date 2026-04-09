import { StorageAdapter, ProjectModel } from "@reporead/core";
import { HomeClient } from "./home-client";

async function getProjects() {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  const storage = new StorageAdapter(repoRoot);
  const projectModel = new ProjectModel(storage);
  try {
    return await projectModel.list();
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const projects = await getProjects();

  const projectData = projects.map((p) => ({
    projectSlug: p.projectSlug,
    repoRoot: p.repoRoot,
    latestVersionId: p.latestVersionId,
  }));

  return <HomeClient projects={projectData} />;
}
