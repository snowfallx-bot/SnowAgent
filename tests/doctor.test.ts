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
    const registry = {
      get(name: AgentName): AgentAdapter | undefined {
        if (name === "copilot") {
          return new FakeAdapter("copilot", {
            available: true,
            executable: "copilot.exe",
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
    expect(report.agents[0]?.detection.executable).toBe("copilot.exe");
    expect(report.agents[0]?.runPreset.inputModePriority).toEqual(["args"]);
    expect(report.agents[0]?.smoke).toBeUndefined();
  });

  it("runs smoke tests for available adapters when requested", async () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const registry = {
      get(name: AgentName): AgentAdapter | undefined {
        if (name === "codex") {
          return new FakeAdapter(
            "codex",
            {
              available: true,
              executable: "codex.cmd",
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
  });
});
