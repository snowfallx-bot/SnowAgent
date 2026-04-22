import fs from "node:fs";
import path from "node:path";

export function ensureDir(targetPath: string): string {
  fs.mkdirSync(targetPath, { recursive: true });
  return targetPath;
}

export function writeTextFile(targetPath: string, content: string): void {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content, "utf8");
}

export function writeJsonFile(targetPath: string, value: unknown): void {
  writeTextFile(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readTextFile(targetPath: string): string {
  return fs.readFileSync(targetPath, "utf8");
}

export function pathExists(targetPath: string): boolean {
  return fs.existsSync(targetPath);
}

