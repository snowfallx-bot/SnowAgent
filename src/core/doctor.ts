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
  persistReport?: boolean;
}

export type DoctorHealthStatus = "healthy" | "warning" | "unhealthy";
export type DoctorActionCategory =
  | "availability"
  | "auth"
  | "config"
  | "probe"
  | "smoke"
  | "timeout";

export interface DoctorAction {
  category: DoctorActionCategory;
  message: string;
  command?: string;
  configPath?: string;
}

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
  recommendedActions: DoctorAction[];
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
  recommendedActions: DoctorAction[];
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function extractStructuredErrorMessage(data: unknown): string | undefined {
  if (typeof data === "string" && data.trim().length > 0) {
    return data.trim();
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      const message = extractStructuredErrorMessage(item);
      if (message) {
        return message;
      }
    }
    return undefined;
  }

  if (!isPlainObject(data)) {
    return undefined;
  }

  if (typeof data.message === "string" && data.message.trim().length > 0) {
    return data.message.trim();
  }

  if (isPlainObject(data.error)) {
    const nested = extractStructuredErrorMessage(data.error);
    if (nested) {
      return nested;
    }
  }

  for (const key of ["data", "result", "details"]) {
    const nested = extractStructuredErrorMessage(data[key]);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function buildSmokeCommand(agentName: AgentName): string {
  return `node .\\dist\\cli\\index.js doctor --agent ${agentName} --smoke --json`;
}

function buildAvailabilityActions(agentName: AgentName): DoctorAction[] {
  return [
    {
      category: "availability",
      message: `Install or expose the ${agentName} CLI on PATH, or point the config to the correct executable path.`,
      command: `where ${agentName}`,
      configPath: `agents.${agentName}.executablePath`
    },
    {
      category: "config",
      message: `Review the configured command candidates for ${agentName} if the binary name differs on this machine.`,
      configPath: `agents.${agentName}.commandCandidates`
    }
  ];
}

function buildProbeActions(agentName: AgentName, detection: AgentDetectionResult): DoctorAction[] {
  const actions: DoctorAction[] = [];

  if (!detection.versionText) {
    actions.push({
      category: "probe",
      message: `No version probe returned output for ${agentName}; consider adjusting the configured version probe args.`,
      configPath: `agents.${agentName}.detect.versionArgs`
    });
  }

  if (!detection.helpText) {
    actions.push({
      category: "probe",
      message: `No help probe returned output for ${agentName}; consider adjusting the configured help probe args.`,
      configPath: `agents.${agentName}.detect.helpArgs`
    });
  }

  return actions;
}

function buildSmokeFailureActions(
  agentName: AgentName,
  smoke: DoctorSmokeResult
): DoctorAction[] {
  const actions: DoctorAction[] = [];
  const structuredMessage = extractStructuredErrorMessage(smoke.parsedData);
  const combinedMessage = [structuredMessage, smoke.stderr]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" ")
    .trim();
  const normalizedMessage = combinedMessage.toLowerCase();

  if (smoke.timedOut) {
    actions.push({
      category: "timeout",
      message: `Smoke test for ${agentName} timed out; increase --timeout-ms or the agent timeout in config before relying on it.`,
      configPath: `agents.${agentName}.timeoutMs`
    });
  }

  if (normalizedMessage.includes("auth")) {
    actions.push({
      category: "auth",
      message: `Configure authentication for ${agentName} before running it in non-interactive mode.`,
      command: agentName === "qwen" ? "qwen auth" : undefined
    });
  }

  if (normalizedMessage.includes("allow-all-tools")) {
    actions.push({
      category: "config",
      message: `The ${agentName} CLI rejected the current non-interactive permission preset; review the configured nonInteractiveArgs.`,
      configPath: `agents.${agentName}.run.nonInteractiveArgs`
    });
  }

  if (actions.length === 0) {
    actions.push({
      category: "smoke",
      message: `Re-run the smoke test for ${agentName} with JSON output and inspect stderr/parsedData for the exact failure.`,
      command: buildSmokeCommand(agentName)
    });
  }

  return actions;
}

function buildAgentActions(
  report: Omit<DoctorAgentReport, "status" | "reasons" | "recommendedActions">,
  smokeEnabled: boolean
): DoctorAction[] {
  const actions: DoctorAction[] = [];

  if (!report.enabled) {
    actions.push({
      category: "config",
      message: `Enable ${report.agentName} in config if you want the router and doctor to consider it.`,
      configPath: `agents.${report.agentName}.enabled`
    });
    return actions;
  }

  if (!report.detection.available) {
    actions.push(...buildAvailabilityActions(report.agentName));
    return actions;
  }

  actions.push(...buildProbeActions(report.agentName, report.detection));

  if (!smokeEnabled) {
    actions.push({
      category: "smoke",
      message: `Run a smoke test for ${report.agentName} to validate the current non-interactive preset on this machine.`,
      command: buildSmokeCommand(report.agentName)
    });
    return actions;
  }

  if (report.smoke && !report.smoke.success) {
    actions.push(...buildSmokeFailureActions(report.agentName, report.smoke));
  }

  return actions;
}

function buildSummaryActions(reports: DoctorAgentReport[]): DoctorAction[] {
  const seen = new Set<string>();
  const actions: DoctorAction[] = [];

  for (const report of reports) {
    for (const action of report.recommendedActions) {
      const key = `${action.category}|${action.message}|${action.command ?? ""}|${action.configPath ?? ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      actions.push(action);
    }
  }

  return actions;
}

function evaluateAgentStatus(
  report: Omit<DoctorAgentReport, "status" | "reasons" | "recommendedActions">,
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
    smokeFailures,
    recommendedActions: buildSummaryActions(reports)
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

      const reportBase: Omit<DoctorAgentReport, "status" | "reasons" | "recommendedActions"> = {
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
        ...evaluateAgentStatus(reportBase, smokeEnabled),
        recommendedActions: buildAgentActions(reportBase, smokeEnabled)
      });
    }

    const summary = buildSummary(reports);
    const artifactPath = this.config.artifacts.saveOutputs && options.persistReport !== false
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
