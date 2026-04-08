export type RepoProfile = {
  projectSlug: string;
  repoRoot: string;
  repoName: string;
  branch: string;
  commitHash: string;
  languages: string[];
  frameworks: string[];
  packageManagers: string[];
  entryFiles: string[];
  importantDirs: string[];
  ignoredPaths: string[];
  sourceFileCount: number;
  docFileCount: number;
  treeSummary: string;
  architectureHints: string[];
};

export type ProjectInfo = {
  projectSlug: string;
  repoRoot: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
  latestVersionId?: string;
  repoProfile?: RepoProfile;
};
