import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AgentAdapter,
  AgentCapability,
  AgentDetectionResult,
  AgentRunInput,
  AgentRunResult,
  BuiltCommand
} from "../src/agents/base";
import { AgentRegistry } from "../src/agents/registry";
import { DEFAULT_CONFIG } from "../src/config/schema";
import { loadBatchPlan } from "../src/core/batch";
import { PreflightService } from "../src/core/preflight";
import { Router } from "../src/core/router";
import { AgentName, Task } from "../src/core/task";
import { ValidationService } from "../src/core/validation";
import { writeTextFile } from "../src/utils/fs";

const capabilities: AgentCapability = {
  supportsStdin: true,
  supportsPromptFile: true,
  supportsArgs: true,
  supportsJsonMode: true,
  supportsCwd: true,
  supportsNonInteractive: true
};

class FakeAdapter implements AgentAdapter {
  public readonly capabilities = capabilities;

  public constructor(
    public readonly name: AgentName,
    private readonly detection: AgentDetectionResult
  ) {}

  public async detect(): Promise<AgentDetectionResult> {
    return this.detection;
  }

  public async buildCommand(): Promise<BuiltCommand> {
    throw new Error("Not used in preflight tests.");
  }

  public parseOutput(): undefined {
    return undefined;
  }

  public async run(_input: AgentRunInput): Promise<AgentRunResult> {
    throw new Error("Not used in preflight tests.");
  }
}

describe("PreflightService", () => {
  it("marks a task as ready when validation and routed agents are available", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-preflight-task-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    config.artifacts.rootDir = "artifacts-preflight";

    const adapters: Partial<Record<AgentName, AgentAdapter>> = {
      codex: new FakeAdapter("codex", {
        available: true,
        executable: "codex.exe",
        detectedInputModes: ["stdin"],
        notes: []
      }),
      copilot: new FakeAdapter("copilot", {
        available: true,
        executable: "copilot.exe",
        detectedInputModes: ["args"],
        notes: []
      }),
      qwen: new FakeAdapter("qwen", {
        available: true,
        executable: "qwen.exe",
        detectedInputModes: ["args"],
        notes: []
      })
    };

    const registry = {
      get(name: AgentName): AgentAdapter | undefined {
        return adapters[name];
      }
    } as AgentRegistry;

    const service = new PreflightService(
      config,
      registry,
      new Router(config),
      new ValidationService(config)
    );
    const task: Task = {
      id: "preflight-task",
      type: "summarize",
      prompt: "Summarize this issue.",
      cwd: tempDir,
      preferredAgent: "auto"
    };

    const report = await service.inspectTask(task, {
      artifactCwd: tempDir
    });

    expect(report.status).toBe("ready");
    expect(report.availableAgents).toBe(3);
    expect(report.artifactPath && fs.existsSync(report.artifactPath)).toBe(true);
  });

  it("marks a task as blocked when no routed agent is available", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-preflight-blocked-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const adapters: Partial<Record<AgentName, AgentAdapter>> = {
      codex: new FakeAdapter("codex", {
        available: false,
        detectedInputModes: [],
        notes: [],
        error: "not found"
      }),
      copilot: new FakeAdapter("copilot", {
        available: false,
        detectedInputModes: [],
        notes: [],
        error: "not found"
      }),
      qwen: new FakeAdapter("qwen", {
        available: false,
        detectedInputModes: [],
        notes: [],
        error: "not found"
      })
    };

    const registry = {
      get(name: AgentName): AgentAdapter | undefined {
        return adapters[name];
      }
    } as AgentRegistry;

    const service = new PreflightService(
      config,
      registry,
      new Router(config),
      new ValidationService(config)
    );
    const task: Task = {
      id: "preflight-blocked",
      type: "review",
      prompt: "Review this diff.",
      cwd: tempDir,
      preferredAgent: "auto"
    };

    const report = await service.inspectTask(task);

    expect(report.status).toBe("blocked");
    expect(report.availableAgents).toBe(0);
    expect(report.recommendedActions[0]).toContain("No routed agents");
  });

  it("aggregates blocked and warning states for a batch plan", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-preflight-batch-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    config.artifacts.rootDir = "artifacts-preflight";
    const promptPath = path.join(tempDir, "prompt.txt");
    const summarizeTaskPath = path.join(tempDir, "summarize.task.yaml");
    const reviewTaskPath = path.join(tempDir, "review.task.yaml");
    const planPath = path.join(tempDir, "demo.batch.yaml");

    writeTextFile(promptPath, "Task prompt.");
    writeTextFile(
      summarizeTaskPath,
      [
        "type: summarize",
        "promptFile: ./prompt.txt",
        "cwd: ."
      ].join("\n")
    );
    writeTextFile(
      reviewTaskPath,
      [
        "type: review",
        "promptFile: ./prompt.txt",
        "cwd: ."
      ].join("\n")
    );
    writeTextFile(
      planPath,
      [
        "continueOnError: true",
        "tasks:",
        "  - path: ./summarize.task.yaml",
        "    label: summarize",
        "  - path: ./review.task.yaml",
        "    label: review",
        "  - path: ./missing.task.yaml",
        "    label: missing"
      ].join("\n")
    );

    const adapters: Partial<Record<AgentName, AgentAdapter>> = {
      codex: new FakeAdapter("codex", {
        available: false,
        detectedInputModes: [],
        notes: [],
        error: "not found"
      }),
      copilot: new FakeAdapter("copilot", {
        available: true,
        executable: "copilot.exe",
        detectedInputModes: ["args"],
        notes: []
      }),
      qwen: new FakeAdapter("qwen", {
        available: true,
        executable: "qwen.exe",
        detectedInputModes: ["args"],
        notes: []
      })
    };

    const registry = {
      get(name: AgentName): AgentAdapter | undefined {
        return adapters[name];
      }
    } as AgentRegistry;

    const service = new PreflightService(
      config,
      registry,
      new Router(config),
      new ValidationService(config)
    );

    const report = await service.inspectBatch(loadBatchPlan(planPath), {
      artifactCwd: tempDir
    });

    expect(report.status).toBe("blocked");
    expect(report.summary.totalTasks).toBe(3);
    expect(report.summary.blockedTasks).toBe(1);
    expect(report.summary.warningTasks).toBe(2);
    expect(report.summary.readyTasks).toBe(0);
    expect(report.artifactPath && fs.existsSync(report.artifactPath)).toBe(true);
  });
});
