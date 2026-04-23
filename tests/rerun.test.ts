import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/schema";
import { loadTaskFromRunArtifact, resolveLatestRunTask } from "../src/core/rerun";
import { ensureDir, writeJsonFile } from "../src/utils/fs";

describe("rerun helpers", () => {
  it("loads a task snapshot from a run artifact", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-rerun-artifact-"));
    const artifactPath = path.join(tempDir, "orchestration-result.json");

    writeJsonFile(artifactPath, {
      taskId: "task-1",
      success: true,
      selectedAgent: "copilot",
      completedAt: "2026-04-23T00:00:01.000Z",
      task: {
        id: "task-1",
        type: "summarize",
        prompt: "Summarize this issue.",
        cwd: tempDir,
        preferredAgent: "auto",
        fallbackAgents: ["qwen"]
      }
    });

    const resolution = loadTaskFromRunArtifact(artifactPath);

    expect(resolution.sourceArtifactPath).toBe(artifactPath);
    expect(resolution.task.type).toBe("summarize");
    expect(resolution.originalSelectedAgent).toBe("copilot");
  });

  it("resolves the latest failed run from history", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-rerun-latest-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const successDir = path.join(tempDir, config.artifacts.rootDir, "task-success");
    const failedDir = path.join(tempDir, config.artifacts.rootDir, "task-failed");

    ensureDir(successDir);
    ensureDir(failedDir);
    writeJsonFile(path.join(successDir, "orchestration-result.json"), {
      taskId: "task-success",
      success: true,
      completedAt: "2026-04-23T00:00:01.000Z",
      route: {
        taskType: "summarize"
      },
      task: {
        id: "task-success",
        type: "summarize",
        prompt: "Good run",
        cwd: tempDir
      }
    });
    writeJsonFile(path.join(failedDir, "orchestration-result.json"), {
      taskId: "task-failed",
      success: false,
      completedAt: "2026-04-23T00:00:02.000Z",
      route: {
        taskType: "fix"
      },
      task: {
        id: "task-failed",
        type: "fix",
        prompt: "Broken run",
        cwd: tempDir
      }
    });

    const resolution = resolveLatestRunTask(config, tempDir, {
      failedOnly: true
    });

    expect(resolution.source).toBe("latest_failed");
    expect(resolution.task.id).toBe("task-failed");
    expect(resolution.originalSuccess).toBe(false);
  });

  it("throws when the run artifact is too old to contain a task snapshot", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-rerun-old-"));
    const artifactPath = path.join(tempDir, "orchestration-result.json");

    writeJsonFile(artifactPath, {
      taskId: "old-task",
      success: false
    });

    expect(() => loadTaskFromRunArtifact(artifactPath)).toThrow("task snapshot");
  });
});
