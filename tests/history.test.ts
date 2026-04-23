import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/schema";
import { ArtifactHistoryService } from "../src/core/history";
import { ensureDir, writeJsonFile } from "../src/utils/fs";

describe("ArtifactHistoryService", () => {
  it("lists recent doctor, preview, validation, batch, and run artifacts", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-history-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const artifactsRoot = path.join(tempDir, config.artifacts.rootDir);

    ensureDir(path.join(artifactsRoot, "doctor"));
    ensureDir(path.join(artifactsRoot, "previews"));
    ensureDir(path.join(artifactsRoot, "batches"));
    ensureDir(path.join(artifactsRoot, "validation"));
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

    expect(report.totalEntries).toBe(6);
    expect(report.entries[0]?.kind).toBe("validation");
    expect(report.entries[1]?.kind).toBe("batch");
    expect(report.entries[2]?.kind).toBe("prompt_preview");
    expect(report.entries[3]?.kind).toBe("doctor");
    expect(report.entries[4]?.kind).toBe("route_preview");
    expect(report.entries[5]?.kind).toBe("run");
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
});
