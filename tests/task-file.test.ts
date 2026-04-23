import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadTaskFile, writeTaskFile } from "../src/core/task-file";
import { writeTextFile } from "../src/utils/fs";

describe("loadTaskFile", () => {
  it("loads yaml task files with relative promptFile and cwd", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-taskfile-"));
    const promptPath = path.join(tempDir, "issue.txt");
    const taskPath = path.join(tempDir, "task.yaml");

    writeTextFile(promptPath, "Summarize the issue from file.");
    writeTextFile(
      taskPath,
      [
        "type: summarize",
        "title: Summarize from task file",
        "promptFile: ./issue.txt",
        "cwd: ./workspace",
        "preferredAgent: copilot",
        "fallbackAgents:",
        "  - qwen",
        "timeoutMs: 15000",
        "metadata:",
        "  source: regression-suite"
      ].join("\n")
    );

    const loaded = loadTaskFile(taskPath);

    expect(loaded.taskFilePath).toBe(taskPath);
    expect(loaded.task.type).toBe("summarize");
    expect(loaded.task.prompt).toBe("Summarize the issue from file.");
    expect(loaded.task.cwd).toBe(path.join(tempDir, "workspace"));
    expect(loaded.task.preferredAgent).toBe("copilot");
    expect(loaded.task.fallbackAgents).toEqual(["qwen"]);
    expect(loaded.task.timeoutMs).toBe(15000);
    expect(loaded.task.metadata).toEqual({ source: "regression-suite" });
  });

  it("loads json task files with inline prompt", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-taskjson-"));
    const taskPath = path.join(tempDir, "task.json");

    writeTextFile(
      taskPath,
      JSON.stringify({
        type: "review",
        prompt: "Review the attached diff.",
        preferredAgent: "codex",
        fallbackAgents: ["copilot", "qwen"]
      })
    );

    const loaded = loadTaskFile(taskPath);

    expect(loaded.task.type).toBe("review");
    expect(loaded.task.prompt).toBe("Review the attached diff.");
    expect(loaded.task.preferredAgent).toBe("codex");
    expect(loaded.task.fallbackAgents).toEqual(["copilot", "qwen"]);
  });

  it("writes yaml task files with relative cwd", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-taskwrite-yaml-"));
    const outputPath = path.join(tempDir, "exports", "rerun.task.yaml");

    const written = writeTaskFile(outputPath, {
      id: "task-export-1",
      type: "fix",
      title: "Fix regression",
      prompt: "Please fix the failing test.",
      cwd: path.join(tempDir, "workspace"),
      preferredAgent: "codex",
      fallbackAgents: ["copilot"],
      timeoutMs: 45000,
      metadata: {
        source: "artifact"
      }
    });

    expect(written.format).toBe("yaml");
    expect(written.outputPath).toBe(outputPath);
    expect(written.taskFile.cwd).toBe("../workspace");
    expect(written.taskFile.id).toBe("task-export-1");

    const loaded = loadTaskFile(outputPath);
    expect(loaded.task.cwd).toBe(path.join(tempDir, "workspace"));
    expect(loaded.task.preferredAgent).toBe("codex");
    expect(loaded.task.metadata).toEqual({ source: "artifact" });
  });

  it("writes json task files and can strip the task id", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-taskwrite-json-"));
    const outputPath = path.join(tempDir, "rerun.task.json");

    const written = writeTaskFile(
      outputPath,
      {
        id: "task-export-2",
        type: "summarize",
        prompt: "Summarize the latest incident.",
        cwd: tempDir
      },
      {
        stripId: true
      }
    );

    expect(written.format).toBe("json");
    expect(written.taskFile.id).toBeUndefined();
    expect(JSON.parse(written.content)).not.toHaveProperty("id");

    const loaded = loadTaskFile(outputPath);
    expect(loaded.task.id).toBeUndefined();
    expect(loaded.task.prompt).toBe("Summarize the latest incident.");
  });
});
