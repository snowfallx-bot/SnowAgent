import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/schema";
import { ValidationService } from "../src/core/validation";
import { writeTextFile } from "../src/utils/fs";

describe("ValidationService", () => {
  it("validates discovered defaults when no config file exists", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-validate-config-"));
    const service = new ValidationService();

    const result = service.validateConfig(undefined, tempDir);

    expect(result.valid).toBe(true);
    expect(result.summary).toContain("built-in defaults");
  });

  it("validates task files and batch plans", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-validate-task-"));
    const taskPath = path.join(tempDir, "task.yaml");
    const promptPath = path.join(tempDir, "prompt.txt");
    const planPath = path.join(tempDir, "plan.yaml");
    const service = new ValidationService();

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
        "continueOnError: true",
        "tasks:",
        "  - ./task.yaml"
      ].join("\n")
    );

    const taskResult = service.validateTaskFile(taskPath, tempDir);
    const batchResult = service.validateBatchPlan(planPath, tempDir);

    expect(taskResult.valid).toBe(true);
    expect(taskResult.summary).toContain("type=summarize");
    expect(batchResult.valid).toBe(true);
    expect(batchResult.summary).toContain("1 task");
  });

  it("expands batch validation into referenced task files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-validate-targets-"));
    const taskPath = path.join(tempDir, "task.yaml");
    const promptPath = path.join(tempDir, "prompt.txt");
    const planPath = path.join(tempDir, "plan.yaml");
    const service = new ValidationService();

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
        "continueOnError: true",
        "tasks:",
        "  - ./task.yaml"
      ].join("\n")
    );

    const results = service.validateBatchTargets(planPath, tempDir);

    expect(results).toHaveLength(2);
    expect(results[0]?.kind).toBe("batch");
    expect(results[1]?.kind).toBe("task");
    expect(results[1]?.valid).toBe(true);
  });

  it("reports invalid batch plans with missing task files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-validate-batch-"));
    const planPath = path.join(tempDir, "plan.json");
    const service = new ValidationService();

    writeTextFile(
      planPath,
      JSON.stringify({
        tasks: ["./missing.task.yaml"]
      })
    );

    const result = service.validateBatchPlan(planPath, tempDir);

    expect(result.valid).toBe(false);
    expect(result.summary).toContain("missing task files");
  });

  it("persists validation reports when artifacts are enabled", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-validate-report-"));
    const service = new ValidationService(DEFAULT_CONFIG);

    const report = service.buildReport(
      [
        {
          kind: "config",
          valid: true,
          summary: "Config file is valid."
        }
      ],
      {
        artifactCwd: tempDir
      }
    );

    expect(report.artifactPath).toBeDefined();
    expect(report.artifactPath && fs.existsSync(report.artifactPath)).toBe(true);
  });
});
