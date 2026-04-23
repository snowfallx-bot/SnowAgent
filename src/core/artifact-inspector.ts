import path from "node:path";

import { AppConfig } from "../config/schema";
import { readTextFile } from "../utils/fs";
import {
  ArtifactHistoryEntry,
  ArtifactHistoryFilter,
  ArtifactHistoryKind,
  ArtifactHistoryService,
  classifyArtifactPath
} from "./history";
import { loadTaskFromRunArtifact } from "./rerun";
import { Task } from "./task";

export interface ArtifactInspectionReport {
  generatedAt: string;
  source: "artifact" | "latest";
  artifactPath: string;
  kind?: ArtifactHistoryKind;
  historyFilter?: ArtifactHistoryFilter;
  historyIndex?: number;
  historyRootDir?: string;
  entry?: ArtifactHistoryEntry;
  topLevelKeys: string[];
  raw: unknown;
  taskSnapshot?: Task;
}

export interface InspectArtifactOptions {
  cwd: string;
  artifactPath?: string;
  latest?: boolean;
  kind?: ArtifactHistoryFilter;
  index?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJsonArtifact(artifactPath: string): unknown {
  try {
    return JSON.parse(readTextFile(artifactPath));
  } catch (error) {
    throw new Error(
      `Artifact ${artifactPath} could not be parsed as JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export class ArtifactInspector {
  public constructor(private readonly config: AppConfig) {}

  public inspect(options: InspectArtifactOptions): ArtifactInspectionReport {
    const sourceCount = [
      options.artifactPath,
      options.latest ? "latest" : undefined
    ].filter((value) => value !== undefined).length;

    if (sourceCount !== 1) {
      throw new Error("Provide exactly one of --artifact or --latest.");
    }

    const generatedAt = new Date().toISOString();
    if (options.artifactPath) {
      const artifactPath = path.resolve(options.cwd, options.artifactPath);
      const raw = readJsonArtifact(artifactPath);
      const kind = classifyArtifactPath(artifactPath);
      const taskSnapshot =
        kind === "run" ? loadTaskFromRunArtifact(artifactPath, options.cwd).task : undefined;

      return {
        generatedAt,
        source: "artifact",
        artifactPath,
        kind,
        topLevelKeys: isPlainObject(raw) ? Object.keys(raw) : [],
        raw,
        taskSnapshot
      };
    }

    const history = new ArtifactHistoryService(this.config).list({
      cwd: options.cwd,
      kind: options.kind ?? "all",
      limit: Math.max(1, options.index ?? 1)
    });
    const historyIndex = Math.max(1, options.index ?? 1);
    const entry = history.entries[historyIndex - 1];

    if (!entry) {
      throw new Error(
        `No artifact entry ${historyIndex} was found for kind "${history.filter}" under ${history.rootDir}.`
      );
    }

    const raw = readJsonArtifact(entry.path);
    const taskSnapshot =
      entry.kind === "run" ? loadTaskFromRunArtifact(entry.path, options.cwd).task : undefined;

    return {
      generatedAt,
      source: "latest",
      artifactPath: entry.path,
      kind: entry.kind,
      historyFilter: history.filter,
      historyIndex,
      historyRootDir: history.rootDir,
      entry,
      topLevelKeys: isPlainObject(raw) ? Object.keys(raw) : [],
      raw,
      taskSnapshot
    };
  }
}
