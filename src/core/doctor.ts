import { AgentDetectionResult, AgentRunResult } from "../agents/base";
import { AgentRegistry } from "../agents/registry";
import { AppConfig } from "../config/schema";
import { AGENT_NAMES, AgentName, Task } from "./task";

export interface DoctorOptions {
  cwd: string;
  smoke?: boolean;
  agentNames?: AgentName[];
  timeoutMs?: number;
  prompt?: string;
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

export interface DoctorReport {
  cwd: string;
  generatedAt: string;
  smokeEnabled: boolean;
  agents: DoctorAgentReport[];
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

export class Doctor {
  public constructor(
    private readonly config: AppConfig,
    private readonly registry: AgentRegistry
  ) {}

  public async inspect(options: DoctorOptions): Promise<DoctorReport> {
    const selectedAgents = options.agentNames && options.agentNames.length > 0
      ? options.agentNames
      : [...AGENT_NAMES];

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

      const report: DoctorAgentReport = {
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
        report.smoke = toSmokeResult(smokeResult);
      }

      reports.push(report);
    }

    return {
      cwd: options.cwd,
      generatedAt: new Date().toISOString(),
      smokeEnabled: Boolean(options.smoke),
      agents: reports
    };
  }
}
