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
import { Orchestrator } from "../src/core/orchestrator";
import { PromptBuilder } from "../src/core/prompt-builder";
import { Router } from "../src/core/router";
import { AgentName, Task } from "../src/core/task";
import { Logger } from "../src/utils/logger";

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
    private readonly result: AgentRunResult
  ) {}

  public async detect(): Promise<AgentDetectionResult> {
    return {
      available: true,
      executable: `${this.name}.exe`,
      detectedInputModes: ["stdin"],
      notes: []
    };
  }

  public async buildCommand(): Promise<BuiltCommand> {
    throw new Error("Not used in this test.");
  }

  public parseOutput(): undefined {
    return undefined;
  }

  public async run(_input: AgentRunInput): Promise<AgentRunResult> {
    return this.result;
  }
}

describe("Orchestrator", () => {
  it("falls back to the next available agent after a failure", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-orchestrator-test-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    config.artifacts.rootDir = "artifacts-test";
    const logger = new Logger({ level: "error" });

    const failedResult: AgentRunResult = {
      agentName: "codex",
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: "missing executable",
      durationMs: 15,
      timedOut: false,
      rawOutput: "",
      logs: [],
      attemptCount: 1
    };
    const successResult: AgentRunResult = {
      agentName: "qwen",
      success: true,
      exitCode: 0,
      stdout: "===RESULT_JSON===\n{\"summary\":\"done\"}\n===END_RESULT_JSON===",
      stderr: "",
      durationMs: 20,
      timedOut: false,
      rawOutput: "===RESULT_JSON===\n{\"summary\":\"done\"}\n===END_RESULT_JSON===",
      logs: [],
      attemptCount: 1,
      parsed: {
        format: "result_json",
        data: { summary: "done" },
        rawText: "===RESULT_JSON===\n{\"summary\":\"done\"}\n===END_RESULT_JSON===",
        extractionNotes: []
      }
    };

    const adapters: Partial<Record<AgentName, AgentAdapter>> = {
      codex: new FakeAdapter("codex", failedResult),
      qwen: new FakeAdapter("qwen", successResult)
    };

    const registry = {
      get(name: AgentName): AgentAdapter | undefined {
        return adapters[name];
      }
    } as AgentRegistry;

    const orchestrator = new Orchestrator(
      config,
      registry,
      new Router(config),
      new PromptBuilder(),
      logger
    );

    const task: Task = {
      id: "fallback-test",
      type: "fix",
      title: "Fallback behavior",
      prompt: "Fix the fallback workflow",
      cwd: tempRoot
    };

    const result = await orchestrator.run(task);

    expect(result.success).toBe(true);
    expect(result.selectedAgent).toBe("qwen");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.agentName).toBe("codex");
    expect(result.attempts[1]?.agentName).toBe("qwen");
  });
});

