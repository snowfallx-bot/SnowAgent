import fs from "node:fs";
import path from "node:path";

import { AppConfig } from "../config/schema";
import { pathExists, readTextFile } from "../utils/fs";

export const HISTORY_KINDS = ["doctor", "status", "preview", "preflight", "run", "batch", "validation", "maintenance", "all"] as const;
export type ArtifactHistoryFilter = (typeof HISTORY_KINDS)[number];
export type ArtifactHistoryKind =
  | "doctor"
  | "status"
  | "route_preview"
  | "prompt_preview"
  | "preflight"
  | "run"
  | "batch"
  | "validation"
  | "maintenance";

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
  filters: {
    status?: string;
    taskId?: string;
    selectedAgent?: string;
  };
  totalEntries: number;
  returnedEntries: number;
  entries: ArtifactHistoryEntry[];
}

export interface ArtifactHistoryOptions {
  cwd: string;
  limit?: number;
  kind?: ArtifactHistoryFilter;
  status?: string;
  taskId?: string;
  selectedAgent?: string;
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

function parseStatusEntry(filePath: string, data: Record<string, unknown>): ArtifactHistoryEntry {
  const mode = getString(data.mode) ?? "snapshot";
  const summary = isPlainObject(data.summary) ? data.summary : {};
  const status =
    getString(summary.finalStatus) ??
    getString(summary.status);
  const doctorStatus = getString(summary.doctorStatus);
  const retentionMatches =
    typeof summary.retentionMatches === "number"
      ? summary.retentionMatches
      : typeof summary.retentionMatchedUnits === "number"
        ? summary.retentionMatchedUnits
        : 0;
  const failedRuns =
    typeof summary.failedRuns === "number" ? summary.failedRuns : 0;
  const failedBatches =
    typeof summary.failedBatches === "number" ? summary.failedBatches : 0;
  const baselineStatus = getString(summary.baselineStatus);
  const retentionExecuted = getBoolean(summary.retentionExecuted);
  const reclaimedBytes =
    typeof summary.reclaimedBytes === "number" ? summary.reclaimedBytes : 0;

  return {
    kind: "status",
    path: filePath,
    createdAt: getString(data.generatedAt) ?? toIsoFallback(filePath),
    summary:
      mode === "sweep"
        ? `status sweep baseline=${baselineStatus ?? "unknown"} final=${status ?? "unknown"} retentionExecuted=${retentionExecuted ?? false} reclaimedBytes=${reclaimedBytes} failedRuns=${failedRuns} failedBatches=${failedBatches}`
        : `status status=${status ?? "unknown"} doctor=${doctorStatus ?? "unknown"} retentionMatches=${retentionMatches} failedRuns=${failedRuns} failedBatches=${failedBatches}`,
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

function parseValidationEntry(
  filePath: string,
  data: Record<string, unknown>
): ArtifactHistoryEntry {
  const results = Array.isArray(data.results) ? data.results : [];
  const validTargets = results.filter((item) => {
    return isPlainObject(item) && item.valid === true;
  }).length;
  const invalidTargets = results.length - validTargets;
  const allValid = getBoolean(data.allValid);

  return {
    kind: "validation",
    path: filePath,
    createdAt: getString(data.generatedAt) ?? toIsoFallback(filePath),
    summary: `validation valid=${validTargets} invalid=${invalidTargets} total=${results.length}`,
    status: allValid === undefined ? undefined : allValid ? "success" : "failed",
    success: allValid
  };
}

function parsePreflightEntry(
  filePath: string,
  data: Record<string, unknown>
): ArtifactHistoryEntry {
  const mode = getString(data.mode) ?? "unknown";
  const status = getString(data.status);
  const task = isPlainObject(data.task) ? data.task : {};
  const summary = isPlainObject(data.summary) ? data.summary : {};
  const taskType = getString(task.type);
  const totalTasks = typeof summary.totalTasks === "number" ? summary.totalTasks : undefined;
  const blockedTasks = typeof summary.blockedTasks === "number" ? summary.blockedTasks : undefined;

  return {
    kind: "preflight",
    path: filePath,
    createdAt: getString(data.generatedAt) ?? toIsoFallback(filePath),
    summary:
      mode === "batch"
        ? `preflight batch status=${status ?? "unknown"} total=${totalTasks ?? 0} blocked=${blockedTasks ?? 0}`
        : `preflight task status=${status ?? "unknown"} taskType=${taskType ?? "unknown"}`,
    status,
    taskId: getString(task.id),
    taskType,
    success: status === undefined ? undefined : status !== "blocked"
  };
}

function parseMaintenanceEntry(
  filePath: string,
  data: Record<string, unknown>
): ArtifactHistoryEntry {
  const mode = getString(data.mode) ?? "unknown";
  const filter =
    getString(data.filter) ??
    getString(data.selectedKind) ??
    "all";
  const dryRun = getBoolean(data.dryRun);
  const matchedUnitCount =
    typeof data.matchedUnitCount === "number" ? data.matchedUnitCount : undefined;
  const reclaimableBytes =
    typeof data.reclaimableBytes === "number" ? data.reclaimableBytes : undefined;
  const matchedSizeBytes =
    typeof data.matchedSizeBytes === "number" ? data.matchedSizeBytes : undefined;
  const executedPolicies =
    typeof data.executedPolicies === "number" ? data.executedPolicies : undefined;
  const status =
    mode === "prune" || mode === "retention"
      ? dryRun === true
        ? "dry_run"
        : dryRun === false
          ? "applied"
          : undefined
      : "inventory";

  return {
    kind: "maintenance",
    path: filePath,
    createdAt: getString(data.generatedAt) ?? toIsoFallback(filePath),
    summary:
      mode === "prune"
        ? `maintenance prune filter=${filter} units=${matchedUnitCount ?? 0} reclaimableBytes=${reclaimableBytes ?? 0}`
        : mode === "retention"
          ? `maintenance retention filter=${filter} policies=${executedPolicies ?? 0} reclaimableBytes=${reclaimableBytes ?? 0}`
        : `maintenance inventory filter=${filter} units=${matchedUnitCount ?? 0} sizeBytes=${matchedSizeBytes ?? 0}`,
    status
  };
}

export function classifyArtifactPath(
  filePath: string
): ArtifactHistoryKind | undefined {
  const normalized = filePath.replace(/\\/g, "/");

  if (normalized.includes("/doctor/") && normalized.endsWith(".json")) {
    return "doctor";
  }

  if (normalized.includes("/status/") && normalized.endsWith(".json")) {
    return "status";
  }

  if (normalized.includes("/previews/") && normalized.endsWith(".json")) {
    return path.basename(filePath).startsWith("prompt-")
      ? "prompt_preview"
      : "route_preview";
  }

  if (normalized.includes("/preflight/") && normalized.endsWith(".json")) {
    return "preflight";
  }

  if (normalized.includes("/batches/") && normalized.endsWith(".json")) {
    return "batch";
  }

  if (normalized.includes("/validation/") && normalized.endsWith(".json")) {
    return "validation";
  }

  if (normalized.includes("/maintenance/") && normalized.endsWith(".json")) {
    return "maintenance";
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

function matchesEntryFilters(
  entry: ArtifactHistoryEntry,
  options: Pick<ArtifactHistoryOptions, "status" | "taskId" | "selectedAgent">
): boolean {
  if (options.status && entry.status !== options.status) {
    return false;
  }

  if (options.taskId && !entry.taskId?.includes(options.taskId)) {
    return false;
  }

  if (options.selectedAgent && entry.selectedAgent !== options.selectedAgent) {
    return false;
  }

  return true;
}

export class ArtifactHistoryService {
  public constructor(private readonly config: AppConfig) {}

  public list(options: ArtifactHistoryOptions): ArtifactHistoryReport {
    const limit = Math.max(1, options.limit ?? 20);
    const filter = options.kind ?? "all";
    const rootDir = path.resolve(options.cwd, this.config.artifacts.rootDir);
    const entries: ArtifactHistoryEntry[] = [];

    for (const filePath of walkFiles(rootDir)) {
      const kind = classifyArtifactPath(filePath);
      if (!kind || !matchesFilter(kind, filter)) {
        continue;
      }

      const data = tryReadJson(filePath);
      if (!isPlainObject(data)) {
        continue;
      }

      const entry =
        kind === "doctor"
          ? parseDoctorEntry(filePath, data)
          : kind === "status"
            ? parseStatusEntry(filePath, data)
          : kind === "prompt_preview"
            ? parsePromptPreviewEntry(filePath, data)
            : kind === "route_preview"
              ? parseRoutePreviewEntry(filePath, data)
              : kind === "preflight"
                ? parsePreflightEntry(filePath, data)
                : kind === "batch"
                  ? parseBatchEntry(filePath, data)
                  : kind === "validation"
                    ? parseValidationEntry(filePath, data)
                    : kind === "maintenance"
                      ? parseMaintenanceEntry(filePath, data)
                    : parseRunEntry(filePath, data);

      if (matchesEntryFilters(entry, options)) {
        entries.push(entry);
      }
    }

    entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const limitedEntries = entries.slice(0, limit);

    return {
      generatedAt: new Date().toISOString(),
      rootDir,
      filter,
      filters: {
        status: options.status,
        taskId: options.taskId,
        selectedAgent: options.selectedAgent
      },
      totalEntries: entries.length,
      returnedEntries: limitedEntries.length,
      entries: limitedEntries
    };
  }
}
