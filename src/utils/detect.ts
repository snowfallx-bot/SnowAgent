import fs from "node:fs";
import path from "node:path";

function isExecutableFile(candidatePath: string): boolean {
  try {
    const stats = fs.statSync(candidatePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function resolveFromPath(commandName: string, env: NodeJS.ProcessEnv): string | undefined {
  const pathEntries = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const pathext =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .filter(Boolean)
      : [""];
  const alreadyHasExtension = Boolean(path.extname(commandName));
  const extensions = alreadyHasExtension ? [""] : pathext;

  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(entry, `${commandName}${extension.toLowerCase()}`);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

export function resolveExecutable(
  configuredPath: string | undefined,
  commandCandidates: string[],
  env: NodeJS.ProcessEnv
): string | undefined {
  if (configuredPath) {
    const absolute = path.resolve(configuredPath);
    return isExecutableFile(absolute) ? absolute : undefined;
  }

  for (const candidate of commandCandidates) {
    if (candidate.includes(path.sep) || candidate.includes("/")) {
      const absolute = path.resolve(candidate);
      if (isExecutableFile(absolute)) {
        return absolute;
      }
    }

    const resolved = resolveFromPath(candidate, env);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}
