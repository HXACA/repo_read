import { describe, it, expect } from "vitest";
import { StoragePaths } from "../paths.js";

describe("StoragePaths", () => {
  const paths = new StoragePaths("/home/user/repo");

  it("root is .reporead under repo root", () => {
    expect(paths.root).toBe("/home/user/repo/.reporead");
  });

  it("currentJson points to current.json", () => {
    expect(paths.currentJson).toBe("/home/user/repo/.reporead/current.json");
  });

  it("projectDir builds project path", () => {
    expect(paths.projectDir("my-project")).toBe(
      "/home/user/repo/.reporead/projects/my-project",
    );
  });

  it("projectJson builds project.json path", () => {
    expect(paths.projectJson("my-project")).toBe(
      "/home/user/repo/.reporead/projects/my-project/project.json",
    );
  });

  it("jobDir builds job directory", () => {
    expect(paths.jobDir("proj", "job-1")).toBe(
      "/home/user/repo/.reporead/projects/proj/jobs/job-1",
    );
  });

  it("jobStateJson builds job-state.json path", () => {
    expect(paths.jobStateJson("proj", "job-1")).toBe(
      "/home/user/repo/.reporead/projects/proj/jobs/job-1/job-state.json",
    );
  });

  it("draftDir builds draft version path", () => {
    expect(paths.draftDir("proj", "job-1", "v1")).toBe(
      "/home/user/repo/.reporead/projects/proj/jobs/job-1/draft/v1",
    );
  });

  it("versionDir builds published version path", () => {
    expect(paths.versionDir("proj", "v1")).toBe(
      "/home/user/repo/.reporead/projects/proj/versions/v1",
    );
  });

  it("reviewJson builds review result path", () => {
    expect(paths.reviewJson("proj", "job-1", "intro")).toBe(
      "/home/user/repo/.reporead/projects/proj/jobs/job-1/review/intro.review.json",
    );
  });

  it("validationJson builds validation result path", () => {
    expect(paths.validationJson("proj", "job-1", "intro")).toBe(
      "/home/user/repo/.reporead/projects/proj/jobs/job-1/validation/intro.validation.json",
    );
  });
});
