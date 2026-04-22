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
import { Doctor } from "../src/core/doctor";
import { AgentName } from "../src/core/task";

const capabilities: AgentCapability = {
  supportsStdin: true,
  supportsPromptFile: false,
  supportsArgs: true,
  supportsJsonMode: true,
  supportsCwd: true,
  supportsNonInteractive: true
};

class FakeAdapter implements AgentAdapter {
  public readonly capabilities = capabilities;

  public constructor(
    public readonly name: AgentName,
    private readonly detection: AgentDetectionResult,
    private readonly runResult?: AgentRunResult
  ) {}

  public async detect(): Promise<AgentDetectionResult> {
    return this.detection;
  }

  public async buildCommand(): Promise<BuiltCommand> {
    throw new Error("Not used in doctor tests.");
  }

  public parseOutput() {
    return undefined;
  }

  public async run(_input: AgentRunInput): Promise<AgentRunResult> {
    if (!this.runResult) {
      throw new Error("Unexpected smoke run.");
    }
    return this.runResult;
  }
}

describe("Doctor", () => {
  it("reports detection and run presets without smoke", async () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    config.artifacts.saveOutputs = false;
    const registry = {
      get(name: AgentName): AgentAdapter | undefined {
        if (name === "copilot") {
          return new FakeAdapter("copilot", {
            available: true,
            executable: "copilot.exe",
            versionText: "1.0.0",
            helpText: "help",
            detectedInputModes: ["args"],
            notes: ["ok"]
          });
        }
        return undefined;
      }
    } as AgentRegistry;

    const doctor = new Doctor(config, registry);
    const report = await doctor.inspect({
      cwd: process.cwd(),
      agentNames: ["copilot"]
    });

    expect(report.agents).toHaveLength(1);
    expect(report.agents[0]?.agentName).toBe("copilot");
    expect(report.agents[0]?.status).toBe("healthy");
    expect(report.summary.status).toBe("healthy");
    expect(report.agents[0]?.detection.executable).toBe("copilot.exe");
    expect(report.agents[0]?.runPreset.inputModePriority).toEqual(["args"]);
    expect(report.agents[0]?.smoke).toBeUndefined();
    expect(report.agents[0]?.recommendedActions).toEqual([
      {
        category: "smoke",
        message:
          "Run a smoke test for copilot to validate the current non-interactive preset on this machine.",
        command: "node .\\dist\\cli\\index.js doctor --agent copilot --smoke --json"
      }
    ]);
    expect(report.artifactPath).toBeUndefined();
    expect(report.summary.recommendedActions).toEqual(report.agents[0]?.recommendedActions);
  });

  it("runs smoke tests for available adapters when requested", async () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    config.artifacts.saveOutputs = false;
    const registry = {
      get(name: AgentName): AgentAdapter | undefined {
        if (name === "codex") {
          return new FakeAdapter(
            "codex",
            {
              available: true,
              executable: "codex.cmd",
              versionText: "1.0.0",
              helpText: "help",
              detectedInputModes: ["stdin"],
              notes: []
            },
            {
              agentName: "codex",
              success: true,
              exitCode: 0,
              stdout: "",
              stderr: "",
              durationMs: 123,
              timedOut: false,
              rawOutput: "",
              logs: [],
              attemptCount: 1,
              commandLine: "codex.cmd exec -",
              inputMode: "stdin",
              parsed: {
                format: "result_json",
                data: { ok: true, agent: "codex" },
                rawText: "raw",
                extractionNotes: []
              }
            }
          );
        }
        return undefined;
      }
    } as AgentRegistry;

    const doctor = new Doctor(config, registry);
    const report = await doctor.inspect({
      cwd: process.cwd(),
      smoke: true,
      agentNames: ["codex"],
      timeoutMs: 5000
    });

    expect(report.agents[0]?.smoke).toEqual({
      success: true,
      exitCode: 0,
      durationMs: 123,
      timedOut: false,
      commandLine: "codex.cmd exec -",
      inputMode: "stdin",
      parsedFormat: "result_json",
      parsedData: { ok: true, agent: "codex" },
      stderr: undefined
    });
    expect(report.agents[0]?.status).toBe("healthy");
    expect(report.summary.smokeFailures).toBe(0);
    expect(report.agents[0]?.recommendedActions).toEqual([]);
  });

  it("writes doctor artifacts and marks failed smoke runs unhealthy", async () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-doctor-"));
    const registry = {
      get(name: AgentName): AgentAdapter | undefined {
        if (name === "qwen") {
          return new FakeAdapter(
            "qwen",
            {
              available: true,
              executable: "qwen.cmd",
              versionText: "1.0.0",
              helpText: "help",
              detectedInputModes: ["args"],
              notes: []
            },
            {
              agentName: "qwen",
              success: false,
              exitCode: 1,
              stdout: "",
              stderr: "missing auth",
              durationMs: 321,
              timedOut: false,
              rawOutput: "",
              logs: [],
              attemptCount: 2,
              commandLine: "qwen.cmd prompt",
              inputMode: "args",
              parsed: {
                format: "json",
                data: [
                  {
                    error: {
                      message:
                        "No auth type is selected. Please configure an auth type before running in non-interactive mode."
                    }
                  }
                ],
                rawText: "raw",
                extractionNotes: []
              }
            }
          );
        }
        return undefined;
      }
    } as AgentRegistry;

    const doctor = new Doctor(config, registry);
    const report = await doctor.inspect({
      cwd: tempDir,
      smoke: true,
      agentNames: ["qwen"],
      timeoutMs: 5000
    });

    expect(report.summary.status).toBe("unhealthy");
    expect(report.summary.smokeFailures).toBe(1);
    expect(report.agents[0]?.status).toBe("unhealthy");
    expect(report.agents[0]?.reasons).toContain(
      "Smoke test failed with exitCode=1 timedOut=false."
    );
    expect(report.agents[0]?.recommendedActions).toEqual([
      {
        category: "auth",
        message: "Configure authentication for qwen before running it in non-interactive mode.",
        command: "qwen auth"
      }
    ]);
    expect(report.artifactPath).toBeDefined();
    expect(report.artifactPath && fs.existsSync(report.artifactPath)).toBe(true);

    const savedReport = JSON.parse(
      fs.readFileSync(report.artifactPath as string, "utf8")
    ) as { summary: { status: string } };

    expect(savedReport.summary.status).toBe("unhealthy");
  });
});
