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
});
