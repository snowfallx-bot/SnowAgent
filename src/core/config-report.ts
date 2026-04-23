import { AppConfig, RETENTION_POLICY_KINDS, RetentionPolicyKind } from "../config/schema";
import { AGENT_NAMES, AgentName, TASK_TYPES, TaskType } from "./task";

export interface ConfigReportAgent {
  name: AgentName;
  enabled: boolean;
  executablePath?: string;
  commandCandidates: string[];
  defaultArgs: string[];
  inputModePriority: string[];
  timeoutMs: number;
  retries: number;
  detect: {
    versionArgs: string[][];
    helpArgs: string[][];
  };
  run: {
    stdinArgs: string[];
    promptFileArgs: string[];
    promptArgArgs: string[];
    jsonModeArgs: string[];
    nonInteractiveArgs: string[];
    cwdArgs: string[];
  };
  notes: string[];
}

export interface ConfigReport {
  generatedAt: string;
  configPath?: string;
  usingDefaultConfig: boolean;
  logging: AppConfig["logging"];
  runtime: AppConfig["runtime"];
  artifacts: AppConfig["artifacts"];
  retention: Record<RetentionPolicyKind, AppConfig["retention"][RetentionPolicyKind]>;
  routing: Record<TaskType, AgentName[]>;
  agents: ConfigReportAgent[];
}

export interface ConfigReportOptions {
  agentNames?: AgentName[];
}

export class ConfigReportService {
  public constructor(
    private readonly config: AppConfig,
    private readonly configPath?: string
  ) {}

  public inspect(options?: ConfigReportOptions): ConfigReport {
    const agentNames = options?.agentNames?.length
      ? options.agentNames
      : [...AGENT_NAMES];

    return {
      generatedAt: new Date().toISOString(),
      configPath: this.configPath,
      usingDefaultConfig: this.configPath === undefined,
      logging: this.config.logging,
      runtime: this.config.runtime,
      artifacts: this.config.artifacts,
      retention: Object.fromEntries(
        RETENTION_POLICY_KINDS.map((kind) => [
          kind,
          { ...this.config.retention[kind] }
        ])
      ) as Record<RetentionPolicyKind, AppConfig["retention"][RetentionPolicyKind]>,
      routing: Object.fromEntries(
        TASK_TYPES.map((taskType) => [taskType, [...this.config.routing.routes[taskType]]])
      ) as Record<TaskType, AgentName[]>,
      agents: agentNames.map((name) => ({
        name,
        enabled: this.config.agents[name].enabled,
        executablePath: this.config.agents[name].executablePath,
        commandCandidates: [...this.config.agents[name].commandCandidates],
        defaultArgs: [...this.config.agents[name].defaultArgs],
        inputModePriority: [...this.config.agents[name].inputModePriority],
        timeoutMs: this.config.agents[name].timeoutMs,
        retries: this.config.agents[name].retries,
        detect: {
          versionArgs: this.config.agents[name].detect.versionArgs.map((args) => [...args]),
          helpArgs: this.config.agents[name].detect.helpArgs.map((args) => [...args])
        },
        run: {
          stdinArgs: [...this.config.agents[name].run.stdinArgs],
          promptFileArgs: [...this.config.agents[name].run.promptFileArgs],
          promptArgArgs: [...this.config.agents[name].run.promptArgArgs],
          jsonModeArgs: [...this.config.agents[name].run.jsonModeArgs],
          nonInteractiveArgs: [...this.config.agents[name].run.nonInteractiveArgs],
          cwdArgs: [...this.config.agents[name].run.cwdArgs]
        },
        notes: [...this.config.agents[name].notes]
      }))
    };
  }
}
