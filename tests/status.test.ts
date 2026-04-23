import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, RETENTION_POLICY_KINDS } from "../src/config/schema";
import { ArtifactMaintenanceService } from "../src/core/artifact-maintenance";
import { DoctorReport } from "../src/core/doctor";
import { ArtifactHistoryService } from "../src/core/history";
import { RetentionService } from "../src/core/retention";
import { StatusService } from "../src/core/status";
import { ValidationService } from "../src/core/validation";
import { ensureDir, writeJsonFile, writeTextFile } from "../src/utils/fs";

function createDoctorReport(status: "healthy" | "warning" | "unhealthy"): DoctorReport {
  return {
    cwd: process.cwd(),
    generatedAt: "2026-04-23T00:00:01.000Z",
    smokeEnabled: false,
    summary: {
      status,
      totalAgents: 1,
      healthyAgents: status === "healthy" ? 1 : 0,
      warningAgents: status === "warning" ? 1 : 0,
      unhealthyAgents: status === "unhealthy" ? 1 : 0,
      availableAgents: 1,
      unavailableAgents: 0,
      smokeFailures: 0,
      recommendedActions: []
    },
    agents: []
  };
}

describe("StatusService", () => {
  it("builds a warning snapshot and persists only the aggregate status artifact", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-status-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const artifactsRoot = path.join(tempDir, config.artifacts.rootDir);

    for (const kind of RETENTION_POLICY_KINDS) {
      config.retention[kind].enabled = false;
    }
    config.retention.log = {
      enabled: true,
      keepLatest: 1
    };

    ensureDir(path.join(artifactsRoot, "runs-failed"));
    ensureDir(path.join(artifactsRoot, "batches"));
    writeTextFile(path.join(artifactsRoot, "session-1.log"), "one");
    writeTextFile(path.join(artifactsRoot, "session-2.log"), "two");
    fs.utimesSync(
      path.join(artifactsRoot, "session-1.log"),
      new Date("2026-04-20T00:00:00.000Z"),
      new Date("2026-04-20T00:00:00.000Z")
    );
    fs.utimesSync(
      path.join(artifactsRoot, "session-2.log"),
      new Date("2026-04-23T00:00:00.000Z"),
      new Date("2026-04-23T00:00:00.000Z")
    );
    writeJsonFile(path.join(artifactsRoot, "runs-failed", "orchestration-result.json"), {
      completedAt: "2026-04-23T00:00:02.000Z",
      taskId: "fix-1",
      success: false,
      selectedAgent: "codex",
      route: {
        taskType: "fix"
      }
    });
    writeJsonFile(path.join(artifactsRoot, "batches", "batch-1.json"), {
      generatedAt: "2026-04-23T00:00:03.000Z",
      succeededTasks: 0,
      failedTasks: 1,
      totalTasks: 1,
      stoppedEarly: false
    });

    const doctor = {
      inspect: async () => createDoctorReport("healthy")
    };
    const service = new StatusService(
      config,
      doctor,
      new ValidationService(config),
      new ArtifactMaintenanceService(config),
      new RetentionService(config),
      new ArtifactHistoryService(config)
    );

    const report = await service.inspect({
      cwd: tempDir,
      failureLimit: 2
    });

    expect(report.summary.status).toBe("warning");
    expect(report.summary.retentionMatches).toBe(1);
    expect(report.summary.failedRuns).toBe(1);
    expect(report.summary.failedBatches).toBe(1);
    expect(report.doctor.artifactPath).toBeUndefined();
    expect(report.artifacts.artifactPath).toBeUndefined();
    expect(report.retentionPreview.artifactPath).toBeUndefined();
    expect(report.artifactPath && fs.existsSync(report.artifactPath)).toBe(true);
    expect(report.summary.recommendedActions.some((action) => action.category === "retention")).toBe(true);
    expect(report.summary.recommendedActions.some((action) => action.category === "history")).toBe(true);
    expect(fs.existsSync(path.join(artifactsRoot, "doctor"))).toBe(false);
    expect(fs.existsSync(path.join(artifactsRoot, "maintenance"))).toBe(false);
    expect(fs.existsSync(path.join(artifactsRoot, "status"))).toBe(true);
  });

  it("escalates the overall snapshot when config validation fails", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-status-config-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const invalidConfigPath = path.join(tempDir, "invalid-config.yaml");
    writeTextFile(invalidConfigPath, "logging: [oops\n");
    const doctor = {
      inspect: async () => createDoctorReport("healthy")
    };
    const service = new StatusService(
      config,
      doctor,
      new ValidationService(config),
      new ArtifactMaintenanceService(config),
      new RetentionService(config),
      new ArtifactHistoryService(config)
    );

    const report = await service.inspect({
      cwd: tempDir,
      configPath: invalidConfigPath
    });

    expect(report.configValidation.valid).toBe(false);
    expect(report.summary.status).toBe("unhealthy");
    expect(report.summary.recommendedActions.some((action) => action.category === "config")).toBe(true);
  });
});
