import { StorageAdapter, ProjectModel } from "@reporead/core";
import { notFound, redirect } from "next/navigation";
import { ProjectNoVersionClient } from "./project-no-version-client";

async function getProject(slug: string) {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  const storage = new StorageAdapter(repoRoot);
  const projectModel = new ProjectModel(storage);
  return projectModel.get(slug);
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await getProject(slug);

  if (!project) notFound();

  if (project.latestVersionId) {
    redirect(`/projects/${slug}/versions/${project.latestVersionId}`);
  }

  return <ProjectNoVersionClient slug={slug} repoRoot={project.repoRoot} />;
}
