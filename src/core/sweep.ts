import path from "node:path";

import { AppConfig } from "../config/schema";
import { writeJsonFile } from "../utils/fs";
import {
  RetentionExecutionReport,
  RetentionService
} from "./retention";
import {
  StatusAction,
  StatusLevel,
  StatusOptions,
  StatusReport,
  StatusService
} from "./status";

export interface SweepRetentionAction {
  requested: boolean;
  executed: boolean;
  skipped: boolean;
  reason?: string;
  report?: RetentionExecutionReport;
}

export interface SweepSummary {
  status: StatusLevel;
  baselineStatus: StatusLevel;
  finalStatus: StatusLevel;
  retentionRequested: boolean;
  retentionExecuted: boolean;
  retentionMatchedUnits: number;
  reclaimedUnits: number;
  reclaimedBytes: number;
  failedRuns: number;
  failedBatches: number;
  recommendedActions: StatusAction[];
}

export interface SweepReport {
  mode: "sweep";
  generatedAt: string;
  cwd: string;
  baseline: StatusReport;
  retentionAction: SweepRetentionAction;
  final: StatusReport;
  summary: SweepSummary;
  artifactPath?: string;
}

export interface SweepOptions extends StatusOptions {
  applyRetention?: boolean;
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

export class SweepService {
  public constructor(
    private readonly config: AppConfig,
    private readonly status: StatusService,
    private readonly retention: RetentionService
  ) {}

  public async execute(options: SweepOptions): Promise<SweepReport> {
    const baseline = await this.status.inspect({
      ...options,
      persistReport: false
    });

    let retentionAction: SweepRetentionAction;
    if (!options.applyRetention) {
      retentionAction = {
        requested: false,
        executed: false,
        skipped: true,
        reason: "Retention application was not requested."
      };
    } else if (baseline.retentionPreview.matchedUnitCount === 0) {
      retentionAction = {
        requested: true,
        executed: false,
        skipped: true,
        reason: "Retention preview found no matching artifacts."
      };
    } else {
      retentionAction = {
        requested: true,
        executed: true,
        skipped: false,
        report: this.retention.execute({
          cwd: options.cwd,
          apply: true,
          persistReport: false
        })
      };
    }

    const final = await this.status.inspect({
      ...options,
      persistReport: false
    });

    const summary: SweepSummary = {
      status: final.summary.status,
      baselineStatus: baseline.summary.status,
      finalStatus: final.summary.status,
      retentionRequested: retentionAction.requested,
      retentionExecuted: retentionAction.executed,
      retentionMatchedUnits: baseline.retentionPreview.matchedUnitCount,
      reclaimedUnits: retentionAction.report?.matchedUnitCount ?? 0,
      reclaimedBytes: retentionAction.report?.reclaimableBytes ?? 0,
      failedRuns: final.summary.failedRuns,
      failedBatches: final.summary.failedBatches,
      recommendedActions: dedupeActions(final.summary.recommendedActions)
    };

    const artifactPath =
      this.config.artifacts.saveOutputs && options.persistReport !== false
        ? path.resolve(
            options.cwd,
            this.config.artifacts.rootDir,
            "status",
            `sweep-${sanitizePathToken(summary.finalStatus)}-${Date.now()}.json`
          )
        : undefined;
    const report: SweepReport = {
      mode: "sweep",
      generatedAt: new Date().toISOString(),
      cwd: options.cwd,
      baseline,
      retentionAction,
      final,
      summary,
      artifactPath
    };

    if (artifactPath) {
      writeJsonFile(artifactPath, report);
    }

    return report;
  }
}
