import fs from "node:fs";
import path from "node:path";

import { AppConfig } from "../config/schema";
import { pathExists, readTextFile } from "../utils/fs";
import { ArtifactHistoryEntry, ArtifactHistoryFilter, ArtifactHistoryService } from "./history";

export const ARTIFACT_FILTER_KINDS = [
  "doctor",
  "preview",
  "preflight",
  "run",
  "batch",
  "validation",
  "log",
  "export",
  "other",
  "all"
] as const;
export type ArtifactFilterKind = (typeof ARTIFACT_FILTER_KINDS)[number];

export const PRUNABLE_ARTIFACT_KINDS = [
  "doctor",
  "preview",
  "preflight",
  "run",
  "batch",
  "validation",
  "log",
  "all"
] as const;
export type PrunableArtifactKind = (typeof PRUNABLE_ARTIFACT_KINDS)[number];

export type ArtifactManagedKind = Exclude<ArtifactFilterKind, "all">;

interface ArtifactUnit {
  kind: ArtifactManagedKind;
  primaryPath: string;
  createdAt: string;
  filePaths: string[];
  deletePaths: string[];
  fileCount: number;
  sizeBytes: number;
  status?: string;
  taskId?: string;
  taskType?: string;
  selectedAgent?: string;
}

export interface ArtifactInventoryKindSummary {
  kind: ArtifactManagedKind;
  unitCount: number;
  fileCount: number;
  totalSizeBytes: number;
  newestCreatedAt?: string;
  newestPath?: string;
}

export interface ArtifactInventoryReport {
  generatedAt: string;
  rootDir: string;
  filter: ArtifactFilterKind;
  filters: {
    status?: string;
    taskId?: string;
    selectedAgent?: string;
  };
  totalRootFileCount: number;
  totalRootSizeBytes: number;
  matchedUnitCount: number;
  matchedFileCount: number;
  matchedSizeBytes: number;
  kinds: ArtifactInventoryKindSummary[];
}

export interface ArtifactInventoryOptions {
  cwd: string;
  kind?: ArtifactFilterKind;
  status?: string;
  taskId?: string;
  selectedAgent?: string;
}

export interface ArtifactPruneCandidate {
  kind: ArtifactManagedKind;
  primaryPath: string;
  createdAt: string;
  fileCount: number;
  sizeBytes: number;
  status?: string;
  taskId?: string;
  taskType?: string;
  selectedAgent?: string;
  deletePaths: string[];
}

export interface ArtifactPruneReport {
  generatedAt: string;
  rootDir: string;
  dryRun: boolean;
  filter: PrunableArtifactKind;
  filters: {
    status?: string;
    taskId?: string;
    selectedAgent?: string;
  };
  rules: {
    olderThanDays?: number;
    keepLatest?: number;
  };
  matchedUnitCount: number;
  matchedFileCount: number;
  reclaimableBytes: number;
  candidates: ArtifactPruneCandidate[];
}

export interface ArtifactPruneOptions {
  cwd: string;
  kind?: PrunableArtifactKind;
  status?: string;
  taskId?: string;
  selectedAgent?: string;
  olderThanDays?: number;
  keepLatest?: number;
  apply?: boolean;
}

function normalizePath(value: string): string {
  return path.resolve(value).replace(/\\/g, "/").toLowerCase();
}

function isPathInside(rootDir: string, targetPath: string): boolean {
  const normalizedRoot = normalizePath(rootDir);
  const normalizedTarget = normalizePath(targetPath);
  return (
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(`${normalizedRoot}/`)
  );
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

function fileSize(filePath: string): number {
  return fs.statSync(filePath).size;
}

function listDirFiles(dirPath: string): string[] {
  if (!pathExists(dirPath)) {
    return [];
  }

  return walkFiles(dirPath);
}

function sumFileSizes(filePaths: string[]): number {
  return filePaths.reduce((total, filePath) => {
    if (!pathExists(filePath)) {
      return total;
    }

    return total + fileSize(filePath);
  }, 0);
}

function mapHistoryKindToArtifactKind(entry: ArtifactHistoryEntry): ArtifactManagedKind {
  if (entry.kind === "route_preview" || entry.kind === "prompt_preview") {
    return "preview";
  }

  return entry.kind;
}

function tryReadBatchRetryPlanPath(filePath: string): string | undefined {
  try {
    const parsed = JSON.parse(readTextFile(filePath)) as { retryPlanPath?: unknown };
    return typeof parsed.retryPlanPath === "string" && parsed.retryPlanPath.trim().length > 0
      ? parsed.retryPlanPath
      : undefined;
  } catch {
    return undefined;
  }
}

function createHistoryUnit(entry: ArtifactHistoryEntry, rootDir: string): ArtifactUnit {
  const kind = mapHistoryKindToArtifactKind(entry);
  let filePaths: string[] = [];
  let deletePaths: string[] = [];

  if (entry.kind === "run") {
    const dirPath = path.dirname(entry.path);
    filePaths = listDirFiles(dirPath);
    deletePaths = [dirPath];
  } else if (entry.kind === "prompt_preview") {
    const promptPath = entry.path.replace(/\.json$/i, ".txt");
    filePaths = [entry.path];
    if (pathExists(promptPath)) {
      filePaths.push(promptPath);
    }
    deletePaths = [...filePaths];
  } else if (entry.kind === "batch") {
    filePaths = [entry.path];
    const retryPlanPath = tryReadBatchRetryPlanPath(entry.path);
    if (retryPlanPath && isPathInside(rootDir, retryPlanPath) && pathExists(retryPlanPath)) {
      filePaths.push(path.resolve(retryPlanPath));
    }
    deletePaths = [...filePaths];
  } else {
    filePaths = [entry.path];
    deletePaths = [entry.path];
  }

  const uniqueFilePaths = [...new Set(filePaths.map((item) => path.resolve(item)))];
  const uniqueDeletePaths = [...new Set(deletePaths.map((item) => path.resolve(item)))];

  return {
    kind,
    primaryPath: entry.path,
    createdAt: entry.createdAt,
    filePaths: uniqueFilePaths,
    deletePaths: uniqueDeletePaths,
    fileCount: uniqueFilePaths.length,
    sizeBytes: sumFileSizes(uniqueFilePaths),
    status: entry.status,
    taskId: entry.taskId,
    taskType: entry.taskType,
    selectedAgent: entry.selectedAgent
  };
}

function isLogFile(filePath: string, rootDir: string): boolean {
  return (
    path.dirname(path.resolve(filePath)) === path.resolve(rootDir) &&
    /^session-\d+\.log$/i.test(path.basename(filePath))
  );
}

function createFileUnit(
  kind: ArtifactManagedKind,
  filePath: string
): ArtifactUnit {
  return {
    kind,
    primaryPath: filePath,
    createdAt: fs.statSync(filePath).mtime.toISOString(),
    filePaths: [filePath],
    deletePaths: [filePath],
    fileCount: 1,
    sizeBytes: fileSize(filePath)
  };
}

function matchesInventoryKind(unit: ArtifactUnit, filter: ArtifactFilterKind): boolean {
  return filter === "all" ? true : unit.kind === filter;
}

function matchesPruneKind(unit: ArtifactUnit, filter: PrunableArtifactKind): boolean {
  return filter === "all" ? unit.kind !== "export" && unit.kind !== "other" : unit.kind === filter;
}

function buildKindSummary(
  kind: ArtifactManagedKind,
  units: ArtifactUnit[]
): ArtifactInventoryKindSummary {
  const newest = [...units].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

  return {
    kind,
    unitCount: units.length,
    fileCount: units.reduce((total, unit) => total + unit.fileCount, 0),
    totalSizeBytes: units.reduce((total, unit) => total + unit.sizeBytes, 0),
    newestCreatedAt: newest?.createdAt,
    newestPath: newest?.primaryPath
  };
}

function toHistoryFilter(kind: ArtifactFilterKind): ArtifactHistoryFilter {
  if (
    kind === "doctor" ||
    kind === "preview" ||
    kind === "preflight" ||
    kind === "run" ||
    kind === "batch" ||
    kind === "validation" ||
    kind === "all"
  ) {
    return kind;
  }

  return "all";
}

function toPruneHistoryFilter(kind: PrunableArtifactKind): ArtifactHistoryFilter {
  if (kind === "log") {
    return "all";
  }

  return toHistoryFilter(kind);
}

function deleteTarget(rootDir: string, targetPath: string): void {
  const resolvedTargetPath = path.resolve(targetPath);
  if (!isPathInside(rootDir, resolvedTargetPath)) {
    throw new Error(`Refusing to delete artifact target outside root: ${resolvedTargetPath}`);
  }

  if (!pathExists(resolvedTargetPath)) {
    return;
  }

  const stat = fs.statSync(resolvedTargetPath);
  if (stat.isDirectory()) {
    fs.rmSync(resolvedTargetPath, { recursive: true, force: true });
    return;
  }

  fs.unlinkSync(resolvedTargetPath);
}

export class ArtifactMaintenanceService {
  private readonly history: ArtifactHistoryService;

  public constructor(private readonly config: AppConfig) {
    this.history = new ArtifactHistoryService(config);
  }

  private collectHistoryUnits(options: {
    cwd: string;
    historyKind: ArtifactHistoryFilter;
    status?: string;
    taskId?: string;
    selectedAgent?: string;
  }): ArtifactUnit[] {
    const report = this.history.list({
      cwd: options.cwd,
      kind: options.historyKind,
      status: options.status,
      taskId: options.taskId,
      selectedAgent: options.selectedAgent,
      limit: Number.MAX_SAFE_INTEGER
    });
    const rootDir = path.resolve(options.cwd, this.config.artifacts.rootDir);

    return report.entries.map((entry) => createHistoryUnit(entry, rootDir));
  }

  private collectLogUnits(rootDir: string): ArtifactUnit[] {
    return walkFiles(rootDir)
      .filter((filePath) => isLogFile(filePath, rootDir))
      .map((filePath) => createFileUnit("log", filePath));
  }

  private collectExtraUnits(
    rootDir: string,
    claimedFiles: Set<string>,
    kind: "export" | "other"
  ): ArtifactUnit[] {
    return walkFiles(rootDir)
      .filter((filePath) => !claimedFiles.has(path.resolve(filePath)))
      .filter((filePath) => {
        const isExport = isPathInside(path.join(rootDir, "exports"), filePath);
        return kind === "export" ? isExport : !isExport;
      })
      .map((filePath) => createFileUnit(kind, filePath));
  }

  public summarize(options: ArtifactInventoryOptions): ArtifactInventoryReport {
    const filter = options.kind ?? "all";
    const rootDir = path.resolve(options.cwd, this.config.artifacts.rootDir);
    const rootFiles = walkFiles(rootDir);
    const rootSizeBytes = sumFileSizes(rootFiles);
    const units: ArtifactUnit[] = [];
    const claimedFiles = new Set<string>();

    const historyUnits = this.collectHistoryUnits({
      cwd: options.cwd,
      historyKind: toHistoryFilter(filter),
      status: options.status,
      taskId: options.taskId,
      selectedAgent: options.selectedAgent
    }).filter((unit) => matchesInventoryKind(unit, filter));

    for (const unit of historyUnits) {
      units.push(unit);
      for (const filePath of unit.filePaths) {
        claimedFiles.add(path.resolve(filePath));
      }
    }

    const includeLogUnits =
      !options.status &&
      !options.taskId &&
      !options.selectedAgent &&
      (filter === "all" || filter === "log");

    if (includeLogUnits) {
      for (const unit of this.collectLogUnits(rootDir)) {
        units.push(unit);
        for (const filePath of unit.filePaths) {
          claimedFiles.add(path.resolve(filePath));
        }
      }
    }

    if (!options.status && !options.taskId && !options.selectedAgent) {
      if (filter === "all" || filter === "export") {
        units.push(...this.collectExtraUnits(rootDir, claimedFiles, "export"));
      }

      if (filter === "all" || filter === "other") {
        const updatedClaimed = new Set(claimedFiles);
        for (const unit of units) {
          for (const filePath of unit.filePaths) {
            updatedClaimed.add(path.resolve(filePath));
          }
        }
        units.push(...this.collectExtraUnits(rootDir, updatedClaimed, "other"));
      }
    }

    const kinds = [...new Set(units.map((unit) => unit.kind))]
      .sort()
      .map((kind) =>
        buildKindSummary(
          kind,
          units.filter((unit) => unit.kind === kind)
        )
      );

    return {
      generatedAt: new Date().toISOString(),
      rootDir,
      filter,
      filters: {
        status: options.status,
        taskId: options.taskId,
        selectedAgent: options.selectedAgent
      },
      totalRootFileCount: rootFiles.length,
      totalRootSizeBytes: rootSizeBytes,
      matchedUnitCount: units.length,
      matchedFileCount: units.reduce((total, unit) => total + unit.fileCount, 0),
      matchedSizeBytes: units.reduce((total, unit) => total + unit.sizeBytes, 0),
      kinds
    };
  }

  public prune(options: ArtifactPruneOptions): ArtifactPruneReport {
    const filter = options.kind ?? "all";
    if (options.olderThanDays === undefined && options.keepLatest === undefined) {
      throw new Error("Provide --older-than-days, --keep-latest, or both before pruning artifacts.");
    }

    const rootDir = path.resolve(options.cwd, this.config.artifacts.rootDir);
    const historyUnits = this.collectHistoryUnits({
      cwd: options.cwd,
      historyKind: toPruneHistoryFilter(filter),
      status: options.status,
      taskId: options.taskId,
      selectedAgent: options.selectedAgent
    }).filter((unit) => matchesPruneKind(unit, filter));
    const logUnits =
      !options.status &&
      !options.taskId &&
      !options.selectedAgent &&
      (filter === "all" || filter === "log")
        ? this.collectLogUnits(rootDir)
        : [];
    const units = [...historyUnits, ...logUnits].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );
    const protectedPaths = new Set(
      options.keepLatest
        ? units.slice(0, options.keepLatest).map((unit) => unit.primaryPath)
        : []
    );
    const cutoffTime =
      options.olderThanDays !== undefined
        ? Date.now() - options.olderThanDays * 24 * 60 * 60 * 1000
        : undefined;

    const candidates = units.filter((unit) => {
      if (protectedPaths.has(unit.primaryPath)) {
        return false;
      }

      if (cutoffTime === undefined) {
        return true;
      }

      return new Date(unit.createdAt).getTime() <= cutoffTime;
    });

    if (options.apply) {
      for (const unit of candidates) {
        for (const deletePath of unit.deletePaths) {
          deleteTarget(rootDir, deletePath);
        }
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      rootDir,
      dryRun: !options.apply,
      filter,
      filters: {
        status: options.status,
        taskId: options.taskId,
        selectedAgent: options.selectedAgent
      },
      rules: {
        olderThanDays: options.olderThanDays,
        keepLatest: options.keepLatest
      },
      matchedUnitCount: candidates.length,
      matchedFileCount: candidates.reduce((total, unit) => total + unit.fileCount, 0),
      reclaimableBytes: candidates.reduce((total, unit) => total + unit.sizeBytes, 0),
      candidates: candidates.map((unit) => ({
        kind: unit.kind,
        primaryPath: unit.primaryPath,
        createdAt: unit.createdAt,
        fileCount: unit.fileCount,
        sizeBytes: unit.sizeBytes,
        status: unit.status,
        taskId: unit.taskId,
        taskType: unit.taskType,
        selectedAgent: unit.selectedAgent,
        deletePaths: [...unit.deletePaths]
      }))
    };
  }
}
