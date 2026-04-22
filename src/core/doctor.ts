import path from "node:path";

import { AgentDetectionResult, AgentRunResult } from "../agents/base";
import { AgentRegistry } from "../agents/registry";
import { AppConfig } from "../config/schema";
import { writeJsonFile } from "../utils/fs";
import { AGENT_NAMES, AgentName, Task } from "./task";

export interface DoctorOptions {
  cwd: string;
  smoke?: boolean;
  agentNames?: AgentName[];
  timeoutMs?: number;
  prompt?: string;
}

export type DoctorHealthStatus = "healthy" | "warning" | "unhealthy";

export interface DoctorSmokeResult {
  success: boolean;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  commandLine?: string;
  inputMode?: string;
  parsedFormat?: string;
  parsedData?: unknown;
  stderr?: string;
}

export interface DoctorAgentReport {
  agentName: AgentName;
  enabled: boolean;
  status: DoctorHealthStatus;
  reasons: string[];
  detection: AgentDetectionResult;
  runPreset: {
    defaultArgs: string[];
    inputModePriority: string[];
    jsonModeArgs: string[];
    nonInteractiveArgs: string[];
    cwdArgs: string[];
    notes: string[];
  };
  smoke?: DoctorSmokeResult;
}

export interface DoctorSummary {
  status: DoctorHealthStatus;
  totalAgents: number;
  healthyAgents: number;
  warningAgents: number;
  unhealthyAgents: number;
  availableAgents: number;
  unavailableAgents: number;
  smokeFailures: number;
}

export interface DoctorReport {
  cwd: string;
  generatedAt: string;
  smokeEnabled: boolean;
  summary: DoctorSummary;
  artifactPath?: string;
  agents: DoctorAgentReport[];
}

function sanitizePathToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "-");
}

function buildSmokePrompt(agentName: AgentName): string {
  return [
    "You are running in a local CLI adapter smoke test.",
    `Target agent: ${agentName}`,
    "Reply with exactly one structured payload and do not use tools.",
    "===RESULT_JSON===",
    `{`,
    `  "ok": true,`,
    `  "agent": "${agentName}"`,
    `}`,
    "===END_RESULT_JSON==="
  ].join("\n");
}

function toSmokeResult(result: AgentRunResult): DoctorSmokeResult {
  return {
    success: result.success,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    commandLine: result.commandLine,
    inputMode: result.inputMode,
    parsedFormat: result.parsed?.format,
    parsedData: result.parsed?.data,
    stderr: result.stderr || undefined
  };
}

function evaluateAgentStatus(
  report: Omit<DoctorAgentReport, "status" | "reasons">,
  smokeEnabled: boolean
): Pick<DoctorAgentReport, "status" | "reasons"> {
  const reasons: string[] = [];

  if (!report.enabled) {
    reasons.push("Agent disabled in config.");
    return {
      status: "warning",
      reasons
    };
  }

  if (!report.detection.available) {
    reasons.push(report.detection.error ?? "Agent detection failed.");
  }

  if (smokeEnabled && report.detection.available) {
    if (!report.smoke) {
      reasons.push("Smoke test did not run.");
    } else if (!report.smoke.success) {
      reasons.push(
        `Smoke test failed with exitCode=${report.smoke.exitCode ?? "null"} timedOut=${report.smoke.timedOut}.`
      );
    }
  }

  if (reasons.length > 0) {
    return {
      status: "unhealthy",
      reasons
    };
  }

  return {
    status: "healthy",
    reasons
  };
}

function buildSummary(reports: DoctorAgentReport[]): DoctorSummary {
  const healthyAgents = reports.filter((report) => report.status === "healthy").length;
  const warningAgents = reports.filter((report) => report.status === "warning").length;
  const unhealthyAgents = reports.filter((report) => report.status === "unhealthy").length;
  const availableAgents = reports.filter((report) => report.detection.available).length;
  const unavailableAgents = reports.length - availableAgents;
  const smokeFailures = reports.filter((report) => report.smoke && !report.smoke.success).length;

  const status: DoctorHealthStatus =
    unhealthyAgents > 0 ? "unhealthy" : warningAgents > 0 ? "warning" : "healthy";

  return {
    status,
    totalAgents: reports.length,
    healthyAgents,
    warningAgents,
    unhealthyAgents,
    availableAgents,
    unavailableAgents,
    smokeFailures
  };
}

export class Doctor {
  public constructor(
    private readonly config: AppConfig,
    private readonly registry: AgentRegistry
  ) {}

  public async inspect(options: DoctorOptions): Promise<DoctorReport> {
    const selectedAgents = options.agentNames && options.agentNames.length > 0
      ? options.agentNames
      : [...AGENT_NAMES];
    const smokeEnabled = Boolean(options.smoke);
    const generatedAt = new Date().toISOString();

    const reports: DoctorAgentReport[] = [];

    for (const agentName of selectedAgents) {
      const agentConfig = this.config.agents[agentName];
      const adapter = this.registry.get(agentName);
      const detection = adapter
        ? await adapter.detect()
        : {
            available: false,
            detectedInputModes: [],
            notes: ["Agent disabled in config."],
            error: "Agent disabled in config."
          };

      const reportBase: Omit<DoctorAgentReport, "status" | "reasons"> = {
        agentName,
        enabled: agentConfig.enabled,
        detection,
        runPreset: {
          defaultArgs: [...agentConfig.defaultArgs],
          inputModePriority: [...agentConfig.inputModePriority],
          jsonModeArgs: [...agentConfig.run.jsonModeArgs],
          nonInteractiveArgs: [...agentConfig.run.nonInteractiveArgs],
          cwdArgs: [...agentConfig.run.cwdArgs],
          notes: [...agentConfig.notes]
        }
      };

      if (options.smoke && adapter && detection.available) {
        const smokePrompt = options.prompt ?? buildSmokePrompt(agentName);
        const smokeTask: Task = {
          id: `doctor-${agentName}`,
          type: "plan",
          title: `${agentName} smoke`,
          prompt: smokePrompt,
          cwd: options.cwd,
          preferredAgent: agentName,
          timeoutMs: options.timeoutMs ?? agentConfig.timeoutMs
        };

        const smokeResult = await adapter.run({
          task: smokeTask,
          cwd: options.cwd,
          prompt: smokePrompt,
          timeoutMs: options.timeoutMs ?? agentConfig.timeoutMs
        });
        reportBase.smoke = toSmokeResult(smokeResult);
      }

      reports.push({
        ...reportBase,
        ...evaluateAgentStatus(reportBase, smokeEnabled)
      });
    }

    const summary = buildSummary(reports);
    const artifactPath = this.config.artifacts.saveOutputs
      ? path.resolve(
          options.cwd,
          this.config.artifacts.rootDir,
          "doctor",
          `${sanitizePathToken(selectedAgents.join("-") || "all")}-${Date.now()}.json`
        )
      : undefined;

    const report: DoctorReport = {
      cwd: options.cwd,
      generatedAt,
      smokeEnabled,
      summary,
      artifactPath,
      agents: reports
    };

    if (artifactPath) {
      writeJsonFile(artifactPath, report);
    }

    return report;
  }
}
