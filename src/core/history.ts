import fs from "node:fs";
import path from "node:path";

import { AppConfig } from "../config/schema";
import { pathExists, readTextFile } from "../utils/fs";

export const HISTORY_KINDS = ["doctor", "preview", "run", "batch", "all"] as const;
export type ArtifactHistoryFilter = (typeof HISTORY_KINDS)[number];
export type ArtifactHistoryKind =
  | "doctor"
  | "route_preview"
  | "prompt_preview"
  | "run"
  | "batch";

export interface ArtifactHistoryEntry {
  kind: ArtifactHistoryKind;
  path: string;
  createdAt: string;
  summary: string;
  status?: string;
  taskId?: string;
  taskType?: string;
  selectedAgent?: string;
  success?: boolean;
}

export interface ArtifactHistoryReport {
  generatedAt: string;
  rootDir: string;
  filter: ArtifactHistoryFilter;
  totalEntries: number;
  returnedEntries: number;
  entries: ArtifactHistoryEntry[];
}

export interface ArtifactHistoryOptions {
  cwd: string;
  limit?: number;
  kind?: ArtifactHistoryFilter;
}

function walkFiles(rootDir: string): string[] {
  if (!pathExists(rootDir)) {
    return [];
  }

  const files: string[] = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function tryReadJson(filePath: string): unknown {
  try {
    return JSON.parse(readTextFile(filePath));
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function toIsoFallback(filePath: string): string {
  return fs.statSync(filePath).mtime.toISOString();
}

function parseDoctorEntry(filePath: string, data: Record<string, unknown>): ArtifactHistoryEntry {
  const summary = isPlainObject(data.summary) ? data.summary : {};
  const status = getString(summary.status);
  const healthyAgents = typeof summary.healthyAgents === "number" ? summary.healthyAgents : 0;
  const unhealthyAgents = typeof summary.unhealthyAgents === "number" ? summary.unhealthyAgents : 0;
  const warningAgents = typeof summary.warningAgents === "number" ? summary.warningAgents : 0;

  return {
    kind: "doctor",
    path: filePath,
    createdAt: getString(data.generatedAt) ?? toIsoFallback(filePath),
    summary: `doctor status=${status ?? "unknown"} healthy=${healthyAgents} warning=${warningAgents} unhealthy=${unhealthyAgents}`,
    status
  };
}

function parsePromptPreviewEntry(
  filePath: string,
  data: Record<string, unknown>
): ArtifactHistoryEntry {
  const task = isPlainObject(data.task) ? data.task : {};
  const taskType = getString(task.type);
  const promptLength =
    typeof data.promptLength === "number" ? data.promptLength : undefined;

  return {
    kind: "prompt_preview",
    path: filePath,
    createdAt: getString(data.generatedAt) ?? toIsoFallback(filePath),
    summary: `prompt preview taskType=${taskType ?? "unknown"} promptLength=${promptLength ?? 0}`,
    taskId: getString(task.id),
    taskType
  };
}

function parseRoutePreviewEntry(
  filePath: string,
  data: Record<string, unknown>
): ArtifactHistoryEntry {
  const task = isPlainObject(data.task) ? data.task : {};
  const route = isPlainObject(data.route) ? data.route : {};
  const orderedAgents = Array.isArray(route.orderedAgents)
    ? route.orderedAgents.filter((value): value is string => typeof value === "string")
    : [];
  const taskType = getString(task.type);

  return {
    kind: "route_preview",
    path: filePath,
    createdAt: getString(data.generatedAt) ?? toIsoFallback(filePath),
    summary: `route preview taskType=${taskType ?? "unknown"} agents=${orderedAgents.join(" -> ") || "(none)"}`,
    taskId: getString(task.id),
    taskType
  };
}

function parseRunEntry(filePath: string, data: Record<string, unknown>): ArtifactHistoryEntry {
  const success = getBoolean(data.success);
  const selectedAgent = getString(data.selectedAgent);
  const route = isPlainObject(data.route) ? data.route : {};
  const taskType = getString(route.taskType);
  const taskId = getString(data.taskId);

  return {
    kind: "run",
    path: filePath,
    createdAt: getString(data.completedAt) ?? toIsoFallback(filePath),
    summary: `run ${success ? "success" : "failed"} taskType=${taskType ?? "unknown"} selectedAgent=${selectedAgent ?? "none"}`,
    status: success === undefined ? undefined : success ? "success" : "failed",
    taskId,
    taskType,
    selectedAgent,
    success
  };
}

function parseBatchEntry(filePath: string, data: Record<string, unknown>): ArtifactHistoryEntry {
  const succeededTasks =
    typeof data.succeededTasks === "number" ? data.succeededTasks : 0;
  const failedTasks = typeof data.failedTasks === "number" ? data.failedTasks : 0;
  const totalTasks = typeof data.totalTasks === "number" ? data.totalTasks : 0;
  const stoppedEarly =
    typeof data.stoppedEarly === "boolean" ? data.stoppedEarly : false;

  return {
    kind: "batch",
    path: filePath,
    createdAt: getString(data.generatedAt) ?? toIsoFallback(filePath),
    summary: `batch succeeded=${succeededTasks} failed=${failedTasks} total=${totalTasks} stoppedEarly=${stoppedEarly}`,
    status: failedTasks > 0 ? "failed" : "success",
    success: failedTasks === 0
  };
}

function classifyArtifact(filePath: string): ArtifactHistoryKind | undefined {
  const normalized = filePath.replace(/\\/g, "/");

  if (normalized.includes("/doctor/") && normalized.endsWith(".json")) {
    return "doctor";
  }

  if (normalized.includes("/previews/") && normalized.endsWith(".json")) {
    return path.basename(filePath).startsWith("prompt-")
      ? "prompt_preview"
      : "route_preview";
  }

  if (normalized.includes("/batches/") && normalized.endsWith(".json")) {
    return "batch";
  }

  if (path.basename(filePath) === "orchestration-result.json") {
    return "run";
  }

  return undefined;
}

function matchesFilter(
  kind: ArtifactHistoryKind,
  filter: ArtifactHistoryFilter
): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "preview") {
    return kind === "route_preview" || kind === "prompt_preview";
  }

  return kind === filter;
}

export class ArtifactHistoryService {
  public constructor(private readonly config: AppConfig) {}

  public list(options: ArtifactHistoryOptions): ArtifactHistoryReport {
    const limit = Math.max(1, options.limit ?? 20);
    const filter = options.kind ?? "all";
    const rootDir = path.resolve(options.cwd, this.config.artifacts.rootDir);
    const entries: ArtifactHistoryEntry[] = [];

    for (const filePath of walkFiles(rootDir)) {
      const kind = classifyArtifact(filePath);
      if (!kind || !matchesFilter(kind, filter)) {
        continue;
      }

      const data = tryReadJson(filePath);
      if (!isPlainObject(data)) {
        continue;
      }

      if (kind === "doctor") {
        entries.push(parseDoctorEntry(filePath, data));
        continue;
      }

      if (kind === "prompt_preview") {
        entries.push(parsePromptPreviewEntry(filePath, data));
        continue;
      }

      if (kind === "route_preview") {
        entries.push(parseRoutePreviewEntry(filePath, data));
        continue;
      }

      if (kind === "batch") {
        entries.push(parseBatchEntry(filePath, data));
        continue;
      }

      entries.push(parseRunEntry(filePath, data));
    }

    entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const limitedEntries = entries.slice(0, limit);

    return {
      generatedAt: new Date().toISOString(),
      rootDir,
      filter,
      totalEntries: entries.length,
      returnedEntries: limitedEntries.length,
      entries: limitedEntries
    };
  }
}
