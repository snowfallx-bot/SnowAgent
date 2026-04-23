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
import { SweepService } from "../src/core/sweep";
import { ValidationService } from "../src/core/validation";
import { ensureDir, writeTextFile } from "../src/utils/fs";

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

describe("SweepService", () => {
  it("applies retention between baseline and final status snapshots", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-sweep-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const artifactsRoot = path.join(tempDir, config.artifacts.rootDir);

    for (const kind of RETENTION_POLICY_KINDS) {
      config.retention[kind].enabled = false;
    }
    config.retention.log = {
      enabled: true,
      keepLatest: 1
    };

    ensureDir(artifactsRoot);
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

    const doctor = {
      inspect: async () => createDoctorReport("healthy")
    };
    const status = new StatusService(
      config,
      doctor,
      new ValidationService(config),
      new ArtifactMaintenanceService(config),
      new RetentionService(config),
      new ArtifactHistoryService(config)
    );
    const sweep = new SweepService(config, status, new RetentionService(config));

    const report = await sweep.execute({
      cwd: tempDir,
      applyRetention: true
    });

    expect(report.mode).toBe("sweep");
    expect(report.summary.baselineStatus).toBe("warning");
    expect(report.summary.finalStatus).toBe("healthy");
    expect(report.summary.retentionRequested).toBe(true);
    expect(report.summary.retentionExecuted).toBe(true);
    expect(report.summary.retentionMatchedUnits).toBe(1);
    expect(report.summary.reclaimedUnits).toBe(1);
    expect(report.retentionAction.report?.artifactPath).toBeUndefined();
    expect(fs.existsSync(path.join(artifactsRoot, "session-1.log"))).toBe(false);
    expect(fs.existsSync(path.join(artifactsRoot, "session-2.log"))).toBe(true);
    expect(report.baseline.artifactPath).toBeUndefined();
    expect(report.final.artifactPath).toBeUndefined();
    expect(report.artifactPath && fs.existsSync(report.artifactPath)).toBe(true);
  });

  it("skips retention when not requested", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-sweep-skip-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const doctor = {
      inspect: async () => createDoctorReport("healthy")
    };
    const status = new StatusService(
      config,
      doctor,
      new ValidationService(config),
      new ArtifactMaintenanceService(config),
      new RetentionService(config),
      new ArtifactHistoryService(config)
    );
    const sweep = new SweepService(config, status, new RetentionService(config));

    const report = await sweep.execute({
      cwd: tempDir
    });

    expect(report.retentionAction.requested).toBe(false);
    expect(report.retentionAction.executed).toBe(false);
    expect(report.retentionAction.skipped).toBe(true);
    expect(report.retentionAction.reason).toContain("not requested");
  });
});
