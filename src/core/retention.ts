import path from "node:path";

import {
  AppConfig,
  RETENTION_POLICY_KINDS,
  RetentionPolicyConfig,
  RetentionPolicyKind
} from "../config/schema";
import { writeJsonFile } from "../utils/fs";
import {
  ArtifactMaintenanceService,
  ArtifactPruneReport
} from "./artifact-maintenance";

export interface RetentionPolicySnapshot {
  kind: RetentionPolicyKind;
  enabled: boolean;
  olderThanDays?: number;
  keepLatest?: number;
  status?: string;
  selectedAgent?: string;
}

export interface RetentionPolicyReport {
  generatedAt: string;
  rootDir: string;
  filter: RetentionPolicyKind | "all";
  policyCount: number;
  enabledPolicyCount: number;
  disabledPolicyCount: number;
  policies: RetentionPolicySnapshot[];
}

export interface RetentionExecutionEntry {
  kind: RetentionPolicyKind;
  enabled: boolean;
  skipped: boolean;
  reason?: string;
  policy: RetentionPolicySnapshot;
  prune?: ArtifactPruneReport;
}

export interface RetentionExecutionReport {
  mode: "retention";
  generatedAt: string;
  rootDir: string;
  dryRun: boolean;
  filter: RetentionPolicyKind | "all";
  selectedKind?: RetentionPolicyKind;
  totalPolicies: number;
  executedPolicies: number;
  skippedPolicies: number;
  matchedUnitCount: number;
  matchedFileCount: number;
  reclaimableBytes: number;
  artifactPath?: string;
  results: RetentionExecutionEntry[];
}

export interface RetentionExecutionOptions {
  cwd: string;
  kind?: RetentionPolicyKind;
  apply?: boolean;
}

function sanitizePathToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "-");
}

function toPolicySnapshot(
  kind: RetentionPolicyKind,
  policy: RetentionPolicyConfig
): RetentionPolicySnapshot {
  return {
    kind,
    enabled: policy.enabled,
    olderThanDays: policy.olderThanDays,
    keepLatest: policy.keepLatest,
    status: policy.status,
    selectedAgent: policy.selectedAgent
  };
}

export class RetentionService {
  private readonly maintenance: ArtifactMaintenanceService;

  public constructor(private readonly config: AppConfig) {
    this.maintenance = new ArtifactMaintenanceService(config);
  }

  public inspect(
    cwd: string,
    kind?: RetentionPolicyKind
  ): RetentionPolicyReport {
    const policyKinds = kind ? [kind] : [...RETENTION_POLICY_KINDS];
    const policies = policyKinds.map((policyKind) =>
      toPolicySnapshot(policyKind, this.config.retention[policyKind])
    );

    return {
      generatedAt: new Date().toISOString(),
      rootDir: path.resolve(cwd, this.config.artifacts.rootDir),
      filter: kind ?? "all",
      policyCount: policies.length,
      enabledPolicyCount: policies.filter((policy) => policy.enabled).length,
      disabledPolicyCount: policies.filter((policy) => !policy.enabled).length,
      policies
    };
  }

  public execute(options: RetentionExecutionOptions): RetentionExecutionReport {
    const policyKinds = options.kind
      ? [options.kind]
      : [...RETENTION_POLICY_KINDS];
    const results: RetentionExecutionEntry[] = [];

    for (const kind of policyKinds) {
      const policy = this.config.retention[kind];
      const snapshot = toPolicySnapshot(kind, policy);
      if (!policy.enabled) {
        results.push({
          kind,
          enabled: false,
          skipped: true,
          reason: "Policy is disabled.",
          policy: snapshot
        });
        continue;
      }

      if (policy.keepLatest === undefined && policy.olderThanDays === undefined) {
        results.push({
          kind,
          enabled: true,
          skipped: true,
          reason: "Policy has no keepLatest or olderThanDays rule.",
          policy: snapshot
        });
        continue;
      }

      const prune = this.maintenance.prune({
        cwd: options.cwd,
        kind,
        status: policy.status,
        selectedAgent: policy.selectedAgent,
        olderThanDays: policy.olderThanDays,
        keepLatest: policy.keepLatest,
        apply: Boolean(options.apply),
        persistReport: false
      });

      results.push({
        kind,
        enabled: true,
        skipped: false,
        policy: snapshot,
        prune
      });
    }

    const artifactPath = this.config.artifacts.saveOutputs
      ? path.resolve(
          options.cwd,
          this.config.artifacts.rootDir,
          "maintenance",
          `retention-${sanitizePathToken(options.kind ?? "all")}-${Date.now()}.json`
        )
      : undefined;
    const report: RetentionExecutionReport = {
      mode: "retention",
      generatedAt: new Date().toISOString(),
      rootDir: path.resolve(options.cwd, this.config.artifacts.rootDir),
      dryRun: !options.apply,
      filter: options.kind ?? "all",
      selectedKind: options.kind,
      totalPolicies: results.length,
      executedPolicies: results.filter((item) => !item.skipped).length,
      skippedPolicies: results.filter((item) => item.skipped).length,
      matchedUnitCount: results.reduce(
        (total, item) => total + (item.prune?.matchedUnitCount ?? 0),
        0
      ),
      matchedFileCount: results.reduce(
        (total, item) => total + (item.prune?.matchedFileCount ?? 0),
        0
      ),
      reclaimableBytes: results.reduce(
        (total, item) => total + (item.prune?.reclaimableBytes ?? 0),
        0
      ),
      artifactPath,
      results
    };

    if (artifactPath) {
      writeJsonFile(artifactPath, report);
    }

    return report;
  }
}
