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
import { PreviewService } from "../src/core/preview";
import { PromptBuilder } from "../src/core/prompt-builder";
import { Router } from "../src/core/router";
import { AgentName, Task } from "../src/core/task";

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
    throw new Error("Not used in preview tests.");
  }

  public parseOutput(): undefined {
    return undefined;
  }

  public async run(_input: AgentRunInput): Promise<AgentRunResult> {
    throw new Error("Not used in preview tests.");
  }
}

describe("PreviewService", () => {
  it("inspects route order and optional detection state", async () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    config.artifacts.saveOutputs = false;
    const registry = {
      get(name: AgentName): AgentAdapter | undefined {
        if (name === "codex") {
          return new FakeAdapter("codex", {
            available: true,
            executable: "codex.cmd",
            versionText: "1.0.0",
            helpText: "help",
            detectedInputModes: ["stdin"],
            notes: ["detected"]
          });
        }
        if (name === "copilot") {
          return new FakeAdapter("copilot", {
            available: true,
            executable: "copilot.exe",
            versionText: "1.0.0",
            helpText: "help",
            detectedInputModes: ["args"],
            notes: ["detected"]
          });
        }
        return undefined;
      }
    } as AgentRegistry;

    const preview = new PreviewService(
      config,
      registry,
      new Router(config),
      new PromptBuilder()
    );
    const task: Task = {
      id: "route-preview",
      type: "review",
      title: "Review route",
      prompt: "",
      cwd: process.cwd(),
      preferredAgent: "copilot",
      fallbackAgents: ["codex"]
    };

    const report = await preview.inspectRoute(task, { includeDetection: true });

    expect(report.route.orderedAgents).toEqual(["copilot", "codex", "qwen"]);
    expect(report.agents[0]?.detection?.executable).toBe("copilot.exe");
    expect(report.agents[1]?.detection?.executable).toBe("codex.cmd");
    expect(report.agents[2]?.detection).toBeUndefined();
    expect(report.artifactPath).toBeUndefined();
  });

  it("writes prompt preview artifacts when configured", async () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-preview-"));
    const registry = {
      get(): AgentAdapter | undefined {
        return undefined;
      }
    } as AgentRegistry;

    const preview = new PreviewService(
      config,
      registry,
      new Router(config),
      new PromptBuilder()
    );
    const task: Task = {
      id: "prompt-preview",
      type: "summarize",
      title: "Prompt preview",
      prompt: "Summarize this issue.",
      cwd: tempDir
    };

    const report = await preview.previewPrompt(task);

    expect(report.prompt).toContain("Task type: summarize");
    expect(report.prompt).toContain("Original task content:");
    expect(report.promptLength).toBe(report.prompt.length);
    expect(report.artifactPath && fs.existsSync(report.artifactPath)).toBe(true);
    expect(report.promptArtifactPath && fs.existsSync(report.promptArtifactPath)).toBe(true);
  });
});
