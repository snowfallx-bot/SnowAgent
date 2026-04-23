import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/schema";
import { ArtifactHistoryService } from "../src/core/history";
import { ensureDir, writeJsonFile } from "../src/utils/fs";

describe("ArtifactHistoryService", () => {
  it("lists recent doctor, status, preview, preflight, validation, batch, run, and maintenance artifacts", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-history-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const artifactsRoot = path.join(tempDir, config.artifacts.rootDir);

    ensureDir(path.join(artifactsRoot, "doctor"));
    ensureDir(path.join(artifactsRoot, "status"));
    ensureDir(path.join(artifactsRoot, "previews"));
    ensureDir(path.join(artifactsRoot, "preflight"));
    ensureDir(path.join(artifactsRoot, "batches"));
    ensureDir(path.join(artifactsRoot, "validation"));
    ensureDir(path.join(artifactsRoot, "maintenance"));
    ensureDir(path.join(artifactsRoot, "task-1"));

    writeJsonFile(path.join(artifactsRoot, "doctor", "doctor-1.json"), {
      generatedAt: "2026-04-23T00:00:03.000Z",
      summary: {
        status: "unhealthy",
        healthyAgents: 1,
        warningAgents: 0,
        unhealthyAgents: 2
      }
    });
    writeJsonFile(path.join(artifactsRoot, "status", "status-1.json"), {
      generatedAt: "2026-04-23T00:00:06.750Z",
      summary: {
        status: "warning",
        doctorStatus: "healthy",
        retentionMatches: 2,
        failedRuns: 1,
        failedBatches: 0
      }
    });
    writeJsonFile(path.join(artifactsRoot, "previews", "route-1.json"), {
      generatedAt: "2026-04-23T00:00:02.000Z",
      task: {
        id: "route-1",
        type: "review"
      },
      route: {
        orderedAgents: ["codex", "copilot"]
      }
    });
    writeJsonFile(path.join(artifactsRoot, "previews", "prompt-1.json"), {
      generatedAt: "2026-04-23T00:00:04.000Z",
      task: {
        id: "prompt-1",
        type: "summarize"
      },
      promptLength: 321
    });
    writeJsonFile(path.join(artifactsRoot, "preflight", "preflight-1.json"), {
      generatedAt: "2026-04-23T00:00:04.500Z",
      mode: "task",
      status: "warning",
      task: {
        id: "preflight-1",
        type: "fix"
      }
    });
    writeJsonFile(path.join(artifactsRoot, "batches", "batch-1.json"), {
      generatedAt: "2026-04-23T00:00:05.000Z",
      succeededTasks: 2,
      failedTasks: 0,
      totalTasks: 2,
      stoppedEarly: false
    });
    writeJsonFile(path.join(artifactsRoot, "validation", "validate-1.json"), {
      generatedAt: "2026-04-23T00:00:06.000Z",
      allValid: false,
      results: [
        { kind: "config", valid: true, summary: "Config file is valid." },
        { kind: "task", valid: false, summary: "Task file validation failed." }
      ]
    });
    writeJsonFile(path.join(artifactsRoot, "maintenance", "inventory-1.json"), {
      generatedAt: "2026-04-23T00:00:06.500Z",
      mode: "inventory",
      filter: "all",
      matchedUnitCount: 7,
      matchedSizeBytes: 2048
    });
    writeJsonFile(path.join(artifactsRoot, "task-1", "orchestration-result.json"), {
      completedAt: "2026-04-23T00:00:01.000Z",
      taskId: "run-1",
      success: true,
      selectedAgent: "copilot",
      route: {
        taskType: "summarize"
      }
    });

    const history = new ArtifactHistoryService(config);
    const report = history.list({
      cwd: tempDir,
      limit: 10,
      kind: "all"
    });

    expect(report.totalEntries).toBe(9);
    expect(report.entries[0]?.kind).toBe("status");
    expect(report.entries[0]?.status).toBe("warning");
    expect(report.entries[1]?.kind).toBe("maintenance");
    expect(report.entries[1]?.status).toBe("inventory");
    expect(report.entries[2]?.kind).toBe("validation");
    expect(report.entries[3]?.kind).toBe("batch");
    expect(report.entries[4]?.kind).toBe("preflight");
    expect(report.entries[5]?.kind).toBe("prompt_preview");
    expect(report.entries[6]?.kind).toBe("doctor");
    expect(report.entries[7]?.kind).toBe("route_preview");
    expect(report.entries[8]?.kind).toBe("run");
  });

  it("filters preview entries and respects the limit", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-history-filter-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const previewsDir = path.join(tempDir, config.artifacts.rootDir, "previews");

    ensureDir(previewsDir);
    writeJsonFile(path.join(previewsDir, "prompt-1.json"), {
      generatedAt: "2026-04-23T00:00:01.000Z",
      task: { id: "prompt-1", type: "summarize" },
      promptLength: 123
    });
    writeJsonFile(path.join(previewsDir, "route-1.json"), {
      generatedAt: "2026-04-23T00:00:02.000Z",
      task: { id: "route-1", type: "review" },
      route: { orderedAgents: ["codex"] }
    });

    const history = new ArtifactHistoryService(config);
    const report = history.list({
      cwd: tempDir,
      limit: 1,
      kind: "preview"
    });

    expect(report.totalEntries).toBe(2);
    expect(report.returnedEntries).toBe(1);
    expect(report.entries[0]?.kind).toBe("route_preview");
  });

  it("filters batch entries", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-history-batch-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const batchDir = path.join(tempDir, config.artifacts.rootDir, "batches");

    ensureDir(batchDir);
    writeJsonFile(path.join(batchDir, "batch-1.json"), {
      generatedAt: "2026-04-23T00:00:01.000Z",
      succeededTasks: 1,
      failedTasks: 1,
      totalTasks: 2,
      stoppedEarly: false
    });

    const history = new ArtifactHistoryService(config);
    const report = history.list({
      cwd: tempDir,
      limit: 5,
      kind: "batch"
    });

    expect(report.totalEntries).toBe(1);
    expect(report.entries[0]?.kind).toBe("batch");
    expect(report.entries[0]?.status).toBe("failed");
  });

  it("filters validation entries", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-history-validation-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const validationDir = path.join(tempDir, config.artifacts.rootDir, "validation");

    ensureDir(validationDir);
    writeJsonFile(path.join(validationDir, "validate-1.json"), {
      generatedAt: "2026-04-23T00:00:01.000Z",
      allValid: true,
      results: [
        { kind: "config", valid: true, summary: "Config file is valid." },
        { kind: "task", valid: true, summary: "Task file is valid." }
      ]
    });

    const history = new ArtifactHistoryService(config);
    const report = history.list({
      cwd: tempDir,
      limit: 5,
      kind: "validation"
    });

    expect(report.totalEntries).toBe(1);
    expect(report.entries[0]?.kind).toBe("validation");
    expect(report.entries[0]?.status).toBe("success");
  });

  it("filters maintenance entries", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-history-maintenance-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const maintenanceDir = path.join(tempDir, config.artifacts.rootDir, "maintenance");

    ensureDir(maintenanceDir);
    writeJsonFile(path.join(maintenanceDir, "prune-1.json"), {
      generatedAt: "2026-04-23T00:00:01.000Z",
      mode: "prune",
      filter: "log",
      dryRun: false,
      matchedUnitCount: 4,
      reclaimableBytes: 1024
    });

    const history = new ArtifactHistoryService(config);
    const report = history.list({
      cwd: tempDir,
      limit: 5,
      kind: "maintenance"
    });

    expect(report.totalEntries).toBe(1);
    expect(report.entries[0]?.kind).toBe("maintenance");
    expect(report.entries[0]?.status).toBe("applied");
  });

  it("filters status entries", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-history-status-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const statusDir = path.join(tempDir, config.artifacts.rootDir, "status");

    ensureDir(statusDir);
    writeJsonFile(path.join(statusDir, "status-1.json"), {
      generatedAt: "2026-04-23T00:00:01.000Z",
      summary: {
        status: "healthy",
        doctorStatus: "healthy",
        retentionMatches: 0,
        failedRuns: 0,
        failedBatches: 0
      }
    });

    const history = new ArtifactHistoryService(config);
    const report = history.list({
      cwd: tempDir,
      limit: 5,
      kind: "status"
    });

    expect(report.totalEntries).toBe(1);
    expect(report.entries[0]?.kind).toBe("status");
    expect(report.entries[0]?.status).toBe("healthy");
  });

  it("parses retention maintenance entries with dry-run status", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-history-retention-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const maintenanceDir = path.join(tempDir, config.artifacts.rootDir, "maintenance");

    ensureDir(maintenanceDir);
    writeJsonFile(path.join(maintenanceDir, "retention-1.json"), {
      generatedAt: "2026-04-23T00:00:01.000Z",
      mode: "retention",
      filter: "log",
      dryRun: true,
      executedPolicies: 1,
      reclaimableBytes: 2048
    });

    const history = new ArtifactHistoryService(config);
    const report = history.list({
      cwd: tempDir,
      limit: 5,
      kind: "maintenance"
    });

    expect(report.totalEntries).toBe(1);
    expect(report.entries[0]?.kind).toBe("maintenance");
    expect(report.entries[0]?.status).toBe("dry_run");
    expect(report.entries[0]?.summary).toContain("retention");
  });

  it("filters preflight entries", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-history-preflight-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const preflightDir = path.join(tempDir, config.artifacts.rootDir, "preflight");

    ensureDir(preflightDir);
    writeJsonFile(path.join(preflightDir, "preflight-1.json"), {
      generatedAt: "2026-04-23T00:00:01.000Z",
      mode: "batch",
      status: "blocked",
      summary: {
        totalTasks: 2,
        blockedTasks: 1
      }
    });

    const history = new ArtifactHistoryService(config);
    const report = history.list({
      cwd: tempDir,
      limit: 5,
      kind: "preflight"
    });

    expect(report.totalEntries).toBe(1);
    expect(report.entries[0]?.kind).toBe("preflight");
    expect(report.entries[0]?.status).toBe("blocked");
  });

  it("filters run entries by status, task id, and selected agent", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-history-run-filter-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const artifactsRoot = path.join(tempDir, config.artifacts.rootDir);
    const failedDir = path.join(artifactsRoot, "task-failed");
    const successDir = path.join(artifactsRoot, "task-success");

    ensureDir(failedDir);
    ensureDir(successDir);
    writeJsonFile(path.join(failedDir, "orchestration-result.json"), {
      completedAt: "2026-04-23T00:00:02.000Z",
      taskId: "fix-123",
      success: false,
      selectedAgent: "codex",
      route: {
        taskType: "fix"
      }
    });
    writeJsonFile(path.join(successDir, "orchestration-result.json"), {
      completedAt: "2026-04-23T00:00:03.000Z",
      taskId: "fix-999",
      success: true,
      selectedAgent: "copilot",
      route: {
        taskType: "fix"
      }
    });

    const history = new ArtifactHistoryService(config);
    const report = history.list({
      cwd: tempDir,
      kind: "run",
      status: "failed",
      taskId: "123",
      selectedAgent: "codex"
    });

    expect(report.totalEntries).toBe(1);
    expect(report.filters.status).toBe("failed");
    expect(report.filters.taskId).toBe("123");
    expect(report.filters.selectedAgent).toBe("codex");
    expect(report.entries[0]?.taskId).toBe("fix-123");
  });
});
