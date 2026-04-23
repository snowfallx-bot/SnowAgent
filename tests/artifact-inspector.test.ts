import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/schema";
import { ArtifactInspector } from "../src/core/artifact-inspector";
import { ensureDir, writeJsonFile } from "../src/utils/fs";

describe("ArtifactInspector", () => {
  it("inspects the latest run artifact and returns the task snapshot", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-inspect-run-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const runDir = path.join(tempDir, config.artifacts.rootDir, "task-1");

    ensureDir(runDir);
    writeJsonFile(path.join(runDir, "orchestration-result.json"), {
      taskId: "task-1",
      success: true,
      selectedAgent: "copilot",
      completedAt: "2026-04-23T00:00:02.000Z",
      route: {
        taskType: "review"
      },
      task: {
        id: "task-1",
        type: "review",
        prompt: "Review the regression diff.",
        cwd: tempDir,
        fallbackAgents: ["codex"]
      }
    });

    const inspector = new ArtifactInspector(config);
    const report = inspector.inspect({
      cwd: tempDir,
      latest: true,
      kind: "run"
    });

    expect(report.source).toBe("latest");
    expect(report.kind).toBe("run");
    expect(report.entry?.selectedAgent).toBe("copilot");
    expect(report.taskSnapshot?.type).toBe("review");
    expect(report.topLevelKeys).toContain("task");
  });

  it("inspects an explicit batch artifact path", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-inspect-batch-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const artifactPath = path.join(
      tempDir,
      config.artifacts.rootDir,
      "batches",
      "batch-1.json"
    );

    writeJsonFile(artifactPath, {
      generatedAt: "2026-04-23T00:00:03.000Z",
      totalTasks: 2,
      failedTasks: 1,
      retryPlanPath: path.join(tempDir, "retry.yaml")
    });

    const inspector = new ArtifactInspector(config);
    const report = inspector.inspect({
      cwd: tempDir,
      artifactPath
    });

    expect(report.source).toBe("artifact");
    expect(report.kind).toBe("batch");
    expect(report.taskSnapshot).toBeUndefined();
    expect(report.topLevelKeys).toEqual(
      expect.arrayContaining(["generatedAt", "totalTasks", "failedTasks"])
    );
  });

  it("inspects the latest filtered run artifact", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-inspect-filtered-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const artifactsRoot = path.join(tempDir, config.artifacts.rootDir);
    const failedDir = path.join(artifactsRoot, "task-failed");
    const successDir = path.join(artifactsRoot, "task-success");

    ensureDir(failedDir);
    ensureDir(successDir);
    writeJsonFile(path.join(failedDir, "orchestration-result.json"), {
      taskId: "task-failed",
      success: false,
      selectedAgent: "codex",
      completedAt: "2026-04-23T00:00:02.000Z",
      route: {
        taskType: "fix"
      },
      task: {
        id: "task-failed",
        type: "fix",
        prompt: "Fix the flaky retry loop.",
        cwd: tempDir
      }
    });
    writeJsonFile(path.join(successDir, "orchestration-result.json"), {
      taskId: "task-success",
      success: true,
      selectedAgent: "qwen",
      completedAt: "2026-04-23T00:00:03.000Z",
      route: {
        taskType: "summarize"
      },
      task: {
        id: "task-success",
        type: "summarize",
        prompt: "Summarize the issue.",
        cwd: tempDir
      }
    });

    const inspector = new ArtifactInspector(config);
    const report = inspector.inspect({
      cwd: tempDir,
      latest: true,
      kind: "run",
      status: "failed",
      selectedAgent: "codex"
    });

    expect(report.entry?.taskId).toBe("task-failed");
    expect(report.historyFilters?.status).toBe("failed");
    expect(report.historyFilters?.selectedAgent).toBe("codex");
    expect(report.taskSnapshot?.type).toBe("fix");
  });

  it("inspects the latest maintenance artifact", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-inspect-maintenance-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const maintenanceDir = path.join(tempDir, config.artifacts.rootDir, "maintenance");

    ensureDir(maintenanceDir);
    writeJsonFile(path.join(maintenanceDir, "inventory-1.json"), {
      generatedAt: "2026-04-23T00:00:05.000Z",
      mode: "inventory",
      filter: "all",
      matchedUnitCount: 3,
      matchedSizeBytes: 4096
    });

    const inspector = new ArtifactInspector(config);
    const report = inspector.inspect({
      cwd: tempDir,
      latest: true,
      kind: "maintenance"
    });

    expect(report.kind).toBe("maintenance");
    expect(report.entry?.status).toBe("inventory");
    expect(report.topLevelKeys).toContain("mode");
    expect(report.taskSnapshot).toBeUndefined();
  });

  it("inspects the latest status artifact", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-inspect-status-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const statusDir = path.join(tempDir, config.artifacts.rootDir, "status");

    ensureDir(statusDir);
    writeJsonFile(path.join(statusDir, "status-1.json"), {
      generatedAt: "2026-04-23T00:00:05.000Z",
      summary: {
        status: "warning",
        doctorStatus: "healthy",
        retentionMatches: 1,
        failedRuns: 1,
        failedBatches: 0
      }
    });

    const inspector = new ArtifactInspector(config);
    const report = inspector.inspect({
      cwd: tempDir,
      latest: true,
      kind: "status"
    });

    expect(report.kind).toBe("status");
    expect(report.entry?.status).toBe("warning");
    expect(report.topLevelKeys).toContain("summary");
  });
});
