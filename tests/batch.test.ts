import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/schema";
import { BatchRunnerService, loadBatchPlan } from "../src/core/batch";
import { OrchestrationResult } from "../src/core/orchestrator";
import { writeTextFile } from "../src/utils/fs";

describe("BatchRunnerService", () => {
  it("loads batch plans and runs each task file", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-batch-"));
    const planPath = path.join(tempDir, "demo.batch.yaml");
    const promptPath = path.join(tempDir, "issue.txt");
    const taskPath = path.join(tempDir, "summarize.task.yaml");

    writeTextFile(promptPath, "Summarize this issue.");
    writeTextFile(
      taskPath,
      [
        "type: summarize",
        "promptFile: ./issue.txt",
        "cwd: .",
        "preferredAgent: copilot"
      ].join("\n")
    );
    writeTextFile(
      planPath,
      [
        "continueOnError: true",
        "tasks:",
        "  - path: ./summarize.task.yaml",
        "    label: summarize-demo"
      ].join("\n")
    );

    const plan = loadBatchPlan(planPath);
    const orchestrator = {
      async run(): Promise<OrchestrationResult> {
        return {
          taskId: "task-1",
          success: true,
          selectedAgent: "copilot",
          route: {
            taskId: "task-1",
            taskType: "summarize",
            preferredAgent: "copilot",
            orderedAgents: ["copilot"],
            reasons: []
          },
          attempts: [],
          prompt: "prompt",
          artifactDir: path.join(tempDir, "artifacts", "task-1"),
          startedAt: "2026-04-23T00:00:00.000Z",
          completedAt: "2026-04-23T00:00:01.000Z"
        };
      }
    };

    const report = await new BatchRunnerService(
      DEFAULT_CONFIG,
      orchestrator
    ).runPlan(plan, { dryRun: true });

    expect(report.totalTasks).toBe(1);
    expect(report.succeededTasks).toBe(1);
    expect(report.failedTasks).toBe(0);
    expect(report.results[0]?.label).toBe("summarize-demo");
    expect(report.results[0]?.selectedAgent).toBe("copilot");
    expect(report.artifactPath && fs.existsSync(report.artifactPath)).toBe(true);
  });

  it("stops early when continueOnError is disabled", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-batch-stop-"));
    const planPath = path.join(tempDir, "stop.batch.yaml");

    writeTextFile(
      planPath,
      JSON.stringify({
        continueOnError: false,
        tasks: ["./missing.task.yaml", "./also-missing.task.yaml"]
      })
    );

    const plan = loadBatchPlan(planPath);
    const orchestrator = {
      async run(): Promise<OrchestrationResult> {
        throw new Error("Should not be called");
      }
    };

    const report = await new BatchRunnerService(
      DEFAULT_CONFIG,
      orchestrator
    ).runPlan(plan, { dryRun: true });

    expect(report.failedTasks).toBe(1);
    expect(report.stoppedEarly).toBe(true);
    expect(report.results).toHaveLength(1);
  });

  it("stores batch artifacts under the execution cwd when provided", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-batch-artifacts-"));
    const planDir = path.join(tempDir, "plans");
    const taskDir = path.join(tempDir, "tasks");
    const planPath = path.join(planDir, "demo.batch.yaml");
    const taskPath = path.join(taskDir, "summarize.task.yaml");
    const promptPath = path.join(taskDir, "prompt.txt");

    fs.mkdirSync(planDir, { recursive: true });
    fs.mkdirSync(taskDir, { recursive: true });
    writeTextFile(promptPath, "Summarize this issue.");
    writeTextFile(
      taskPath,
      [
        "type: summarize",
        "promptFile: ./prompt.txt",
        "cwd: ."
      ].join("\n")
    );
    writeTextFile(
      planPath,
      [
        "tasks:",
        "  - ../tasks/summarize.task.yaml"
      ].join("\n")
    );

    const plan = loadBatchPlan(planPath);
    const orchestrator = {
      async run(): Promise<OrchestrationResult> {
        return {
          taskId: "task-1",
          success: true,
          selectedAgent: "copilot",
          route: {
            taskId: "task-1",
            taskType: "summarize",
            preferredAgent: "auto",
            orderedAgents: ["copilot"],
            reasons: []
          },
          attempts: [],
          prompt: "prompt",
          artifactDir: path.join(tempDir, "artifacts", "task-1"),
          startedAt: "2026-04-23T00:00:00.000Z",
          completedAt: "2026-04-23T00:00:01.000Z"
        };
      }
    };

    const report = await new BatchRunnerService(
      DEFAULT_CONFIG,
      orchestrator
    ).runPlan(plan, { dryRun: true, artifactCwd: tempDir });

    expect(report.artifactPath?.startsWith(path.join(tempDir, "artifacts"))).toBe(true);
  });
});
