import path from "node:path";

import { AppConfig } from "../config/schema";
import { writeJsonFile } from "../utils/fs";
import {
  ArtifactInventoryReport,
  ArtifactMaintenanceService
} from "./artifact-maintenance";
import {
  Doctor,
  DoctorAction,
  DoctorHealthStatus,
  DoctorReport
} from "./doctor";
import { ArtifactHistoryEntry, ArtifactHistoryService } from "./history";
import {
  RetentionExecutionReport,
  RetentionService
} from "./retention";
import { AgentName } from "./task";
import {
  ValidationResult,
  ValidationService
} from "./validation";

export type StatusLevel = "healthy" | "warning" | "unhealthy";
export type StatusActionCategory =
  | DoctorAction["category"]
  | "retention"
  | "history"
  | "config";

export interface StatusAction {
  category: StatusActionCategory;
  message: string;
  command?: string;
  configPath?: string;
  artifactPath?: string;
}

export interface StatusRecentFailures {
  runs: ArtifactHistoryEntry[];
  batches: ArtifactHistoryEntry[];
}

export interface StatusSummary {
  status: StatusLevel;
  configValid: boolean;
  doctorStatus: DoctorHealthStatus;
  artifactUnitCount: number;
  artifactBytes: number;
  retentionMatches: number;
  failedRuns: number;
  failedBatches: number;
  recommendedActions: StatusAction[];
}

export interface StatusReport {
  generatedAt: string;
  cwd: string;
  smokeEnabled: boolean;
  configValidation: ValidationResult;
  doctor: DoctorReport;
  artifacts: ArtifactInventoryReport;
  retentionPreview: RetentionExecutionReport;
  recentFailures: StatusRecentFailures;
  summary: StatusSummary;
  artifactPath?: string;
}

export interface StatusOptions {
  cwd: string;
  configPath?: string;
  smoke?: boolean;
  agentNames?: AgentName[];
  timeoutMs?: number;
  failureLimit?: number;
}

function sanitizePathToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "-");
}

function dedupeActions(actions: StatusAction[]): StatusAction[] {
  const seen = new Set<string>();
  const deduped: StatusAction[] = [];

  for (const action of actions) {
    const key = [
      action.category,
      action.message,
      action.command ?? "",
      action.configPath ?? "",
      action.artifactPath ?? ""
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(action);
  }

  return deduped;
}

function buildSummaryStatus(options: {
  configValidation: ValidationResult;
  doctorStatus: DoctorHealthStatus;
  retentionMatches: number;
  failedRuns: number;
  failedBatches: number;
}): StatusLevel {
  if (!options.configValidation.valid || options.doctorStatus === "unhealthy") {
    return "unhealthy";
  }

  if (
    options.doctorStatus === "warning" ||
    options.retentionMatches > 0 ||
    options.failedRuns > 0 ||
    options.failedBatches > 0
  ) {
    return "warning";
  }

  return "healthy";
}

function toStatusActions(actions: DoctorAction[]): StatusAction[] {
  return actions.map((action) => ({
    category: action.category,
    message: action.message,
    command: action.command,
    configPath: action.configPath
  }));
}

export class StatusService {
  public constructor(
    private readonly config: AppConfig,
    private readonly doctor: Pick<Doctor, "inspect">,
    private readonly validation: ValidationService,
    private readonly artifacts: ArtifactMaintenanceService,
    private readonly retention: RetentionService,
    private readonly history: ArtifactHistoryService
  ) {}

  public async inspect(options: StatusOptions): Promise<StatusReport> {
    const failureLimit = Math.max(1, options.failureLimit ?? 3);
    const configValidation = this.validation.validateConfig(
      options.configPath,
      options.cwd
    );
    const doctor = await this.doctor.inspect({
      cwd: options.cwd,
      smoke: options.smoke,
      agentNames: options.agentNames,
      timeoutMs: options.timeoutMs,
      persistReport: false
    });
    const artifacts = this.artifacts.summarize({
      cwd: options.cwd,
      kind: "all",
      persistReport: false
    });
    const retentionPreview = this.retention.execute({
      cwd: options.cwd,
      persistReport: false
    });
    const recentFailures: StatusRecentFailures = {
      runs: this.history.list({
        cwd: options.cwd,
        kind: "run",
        status: "failed",
        limit: failureLimit
      }).entries,
      batches: this.history.list({
        cwd: options.cwd,
        kind: "batch",
        status: "failed",
        limit: failureLimit
      }).entries
    };

    const actions: StatusAction[] = [
      ...toStatusActions(doctor.summary.recommendedActions)
    ];

    if (!configValidation.valid) {
      actions.push({
        category: "config",
        message: configValidation.summary,
        command: "node .\\dist\\cli\\index.js validate --json",
        artifactPath: configValidation.path
      });
    }

    if (retentionPreview.matchedUnitCount > 0) {
      actions.push({
        category: "retention",
        message: `Retention preview matched ${retentionPreview.matchedUnitCount} artifact unit(s); review or apply retention before unattended runs grow further.`,
        command: "node .\\dist\\cli\\index.js apply-retention --json"
      });
    }

    if (recentFailures.runs.length > 0) {
      actions.push({
        category: "history",
        message: `There are ${recentFailures.runs.length} recent failed run artifact(s); inspect the newest failure before trusting the current workflow.`,
        command: "node .\\dist\\cli\\index.js history --kind run --status failed --limit 3 --json",
        artifactPath: recentFailures.runs[0]?.path
      });
    }

    if (recentFailures.batches.length > 0) {
      actions.push({
        category: "history",
        message: `There are ${recentFailures.batches.length} recent failed batch artifact(s); retry or inspect the latest batch before scheduling another unattended pass.`,
        command: "node .\\dist\\cli\\index.js history --kind batch --status failed --limit 3 --json",
        artifactPath: recentFailures.batches[0]?.path
      });
    }

    const summary: StatusSummary = {
      status: buildSummaryStatus({
        configValidation,
        doctorStatus: doctor.summary.status,
        retentionMatches: retentionPreview.matchedUnitCount,
        failedRuns: recentFailures.runs.length,
        failedBatches: recentFailures.batches.length
      }),
      configValid: configValidation.valid,
      doctorStatus: doctor.summary.status,
      artifactUnitCount: artifacts.matchedUnitCount,
      artifactBytes: artifacts.matchedSizeBytes,
      retentionMatches: retentionPreview.matchedUnitCount,
      failedRuns: recentFailures.runs.length,
      failedBatches: recentFailures.batches.length,
      recommendedActions: dedupeActions(actions)
    };

    const artifactPath = this.config.artifacts.saveOutputs
      ? path.resolve(
          options.cwd,
          this.config.artifacts.rootDir,
          "status",
          `status-${sanitizePathToken(summary.status)}-${Date.now()}.json`
        )
      : undefined;
    const report: StatusReport = {
      generatedAt: new Date().toISOString(),
      cwd: options.cwd,
      smokeEnabled: Boolean(options.smoke),
      configValidation,
      doctor,
      artifacts,
      retentionPreview,
      recentFailures,
      summary,
      artifactPath
    };

    if (artifactPath) {
      writeJsonFile(artifactPath, report);
    }

    return report;
  }
}
