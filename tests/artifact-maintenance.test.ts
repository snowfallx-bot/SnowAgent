import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/schema";
import { ArtifactMaintenanceService } from "../src/core/artifact-maintenance";
import { ensureDir, writeJsonFile, writeTextFile } from "../src/utils/fs";

describe("ArtifactMaintenanceService", () => {
  it("summarizes history artifacts, logs, exports, and other files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-artifacts-summary-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const artifactsRoot = path.join(tempDir, config.artifacts.rootDir);

    ensureDir(path.join(artifactsRoot, "doctor"));
    ensureDir(path.join(artifactsRoot, "previews"));
    ensureDir(path.join(artifactsRoot, "batches"));
    ensureDir(path.join(artifactsRoot, "exports"));
    ensureDir(path.join(artifactsRoot, "task-1"));

    writeJsonFile(path.join(artifactsRoot, "doctor", "doctor-1.json"), {
      generatedAt: "2026-04-23T00:00:01.000Z",
      summary: {
        status: "healthy",
        healthyAgents: 3,
        warningAgents: 0,
        unhealthyAgents: 0
      }
    });
    writeJsonFile(path.join(artifactsRoot, "previews", "prompt-1.json"), {
      generatedAt: "2026-04-23T00:00:02.000Z",
      task: {
        id: "prompt-1",
        type: "summarize"
      },
      promptLength: 50
    });
    writeTextFile(path.join(artifactsRoot, "previews", "prompt-1.txt"), "Preview prompt");
    writeJsonFile(path.join(artifactsRoot, "batches", "batch-1.json"), {
      generatedAt: "2026-04-23T00:00:03.000Z",
      succeededTasks: 1,
      failedTasks: 1,
      totalTasks: 2,
      stoppedEarly: false,
      retryPlanPath: path.join(artifactsRoot, "batches", "retry-1.yaml")
    });
    writeTextFile(path.join(artifactsRoot, "batches", "retry-1.yaml"), "tasks: []\n");
    writeJsonFile(path.join(artifactsRoot, "task-1", "orchestration-result.json"), {
      completedAt: "2026-04-23T00:00:04.000Z",
      taskId: "task-1",
      success: true,
      selectedAgent: "copilot",
      route: {
        taskType: "review"
      }
    });
    writeTextFile(path.join(artifactsRoot, "task-1", "task-prompt.txt"), "Prompt");
    writeTextFile(path.join(artifactsRoot, "task-1", "copilot-result.json"), "{}");
    writeTextFile(path.join(artifactsRoot, "session-123.log"), "log");
    writeTextFile(path.join(artifactsRoot, "exports", "saved.task.yaml"), "type: summarize\n");
    writeTextFile(path.join(artifactsRoot, "misc.tmp"), "misc");

    const service = new ArtifactMaintenanceService(config);
    const report = service.summarize({
      cwd: tempDir,
      kind: "all"
    });

    expect(report.totalRootFileCount).toBe(11);
    expect(report.kinds.find((item) => item.kind === "doctor")?.unitCount).toBe(1);
    expect(report.kinds.find((item) => item.kind === "preview")?.fileCount).toBe(2);
    expect(report.kinds.find((item) => item.kind === "batch")?.fileCount).toBe(2);
    expect(report.kinds.find((item) => item.kind === "run")?.fileCount).toBe(3);
    expect(report.kinds.find((item) => item.kind === "log")?.unitCount).toBe(1);
    expect(report.kinds.find((item) => item.kind === "export")?.unitCount).toBe(1);
    expect(report.kinds.find((item) => item.kind === "other")?.unitCount).toBe(1);
  });

  it("dry-runs log pruning and can apply preview pruning", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-artifacts-prune-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const artifactsRoot = path.join(tempDir, config.artifacts.rootDir);
    const previewsDir = path.join(artifactsRoot, "previews");

    ensureDir(previewsDir);
    writeTextFile(path.join(artifactsRoot, "session-1.log"), "one");
    writeTextFile(path.join(artifactsRoot, "session-2.log"), "two");
    writeJsonFile(path.join(previewsDir, "prompt-1.json"), {
      generatedAt: "2026-04-20T00:00:01.000Z",
      task: {
        id: "preview-1",
        type: "summarize"
      },
      promptLength: 12
    });
    writeTextFile(path.join(previewsDir, "prompt-1.txt"), "hello preview");

    fs.utimesSync(path.join(artifactsRoot, "session-1.log"), new Date("2026-04-20T00:00:00.000Z"), new Date("2026-04-20T00:00:00.000Z"));
    fs.utimesSync(path.join(artifactsRoot, "session-2.log"), new Date("2026-04-23T00:00:00.000Z"), new Date("2026-04-23T00:00:00.000Z"));

    const service = new ArtifactMaintenanceService(config);
    const dryRun = service.prune({
      cwd: tempDir,
      kind: "log",
      keepLatest: 1
    });

    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.matchedUnitCount).toBe(1);
    expect(dryRun.candidates[0]?.primaryPath).toContain("session-1.log");
    expect(fs.existsSync(path.join(artifactsRoot, "session-1.log"))).toBe(true);

    const applied = service.prune({
      cwd: tempDir,
      kind: "preview",
      olderThanDays: 1,
      apply: true
    });

    expect(applied.dryRun).toBe(false);
    expect(applied.matchedUnitCount).toBe(1);
    expect(fs.existsSync(path.join(previewsDir, "prompt-1.json"))).toBe(false);
    expect(fs.existsSync(path.join(previewsDir, "prompt-1.txt"))).toBe(false);
  });

  it("does not mix log units into filtered history summaries", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-artifacts-filtered-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const artifactsRoot = path.join(tempDir, config.artifacts.rootDir);
    const runDir = path.join(artifactsRoot, "task-1");

    ensureDir(runDir);
    writeJsonFile(path.join(runDir, "orchestration-result.json"), {
      completedAt: "2026-04-23T00:00:04.000Z",
      taskId: "task-1",
      success: true,
      selectedAgent: "qwen",
      route: {
        taskType: "summarize"
      }
    });
    writeTextFile(path.join(artifactsRoot, "session-1.log"), "log");

    const service = new ArtifactMaintenanceService(config);
    const report = service.summarize({
      cwd: tempDir,
      kind: "all",
      status: "success"
    });

    expect(report.kinds.find((item) => item.kind === "run")?.unitCount).toBe(1);
    expect(report.kinds.find((item) => item.kind === "log")).toBeUndefined();
  });
});
