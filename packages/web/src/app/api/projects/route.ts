import { NextResponse } from "next/server";
import { StorageAdapter, ProjectModel } from "@reporead/core";

function getStorage(): StorageAdapter {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  return new StorageAdapter(repoRoot);
}

export async function GET() {
  try {
    const storage = getStorage();
    const projectModel = new ProjectModel(storage);
    const projects = await projectModel.list();
    return NextResponse.json({ projects });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
