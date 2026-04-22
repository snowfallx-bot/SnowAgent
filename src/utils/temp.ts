import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { ensureDir, writeTextFile } from "./fs";

export function createTempDirectory(prefix: string, parentDir?: string): string {
  const root = parentDir ? ensureDir(parentDir) : ensureDir(path.join(os.tmpdir(), "agent-orchestrator"));
  const directory = path.join(root, `${prefix}-${randomUUID()}`);
  ensureDir(directory);
  return directory;
}

export async function createPromptTempFile(
  content: string,
  agentName: string,
  artifactDir?: string
): Promise<string> {
  const directory = createTempDirectory(`${agentName}-prompt`, artifactDir);
  const filePath = path.join(directory, "prompt.txt");
  writeTextFile(filePath, content);
  return filePath;
}

