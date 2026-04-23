#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { Command } from "commander";

import { AgentRegistry } from "../agents/registry";
import { loadConfig } from "../config/load-config";
import { AppConfig } from "../config/schema";
import { BatchRunReport, BatchRunnerService, loadBatchPlan } from "../core/batch";
import { Orchestrator } from "../core/orchestrator";
import { ConfigReportService } from "../core/config-report";
import { Doctor } from "../core/doctor";
import { ArtifactHistoryService, HISTORY_KINDS } from "../core/history";
import {
  BatchPreflightReport,
  PreflightStatus,
  PreflightService,
  TaskPreflightReport
} from "../core/preflight";
import { PreviewService } from "../core/preview";
import { PromptBuilder } from "../core/prompt-builder";
import {
  resolveLatestFailedRetryPlan,
  resolveRetryPlanFromBatchReport
} from "../core/retry";
import { Router } from "../core/router";
import { loadTaskFile } from "../core/task-file";
import { AGENT_NAMES, AgentName, TASK_TYPES, Task } from "../core/task";
import { ValidationService } from "../core/validation";
import { ProcessRunner } from "../process/process-runner";
import { readTextFile } from "../utils/fs";
import { Logger } from "../utils/logger";

interface Context {
  config: AppConfig;
  configPath?: string;
  registry: AgentRegistry;
  orchestrator: Orchestrator;
  batch: BatchRunnerService;
  doctor: Doctor;
  preview: PreviewService;
  preflight: PreflightService;
  history: ArtifactHistoryService;
  configReport: ConfigReportService;
  validation: ValidationService;
  logger: Logger;
}

async function resolvePromptFromSources(options: {
  prompt?: string;
  inputFile?: string;
  taskPrompt?: string;
  requirePrompt: boolean;
}): Promise<string | undefined> {
  if (options.prompt) {
    return options.prompt;
  }

  if (options.inputFile) {
    return readTextFile(path.resolve(options.inputFile));
  }

  if (options.taskPrompt !== undefined) {
    return options.taskPrompt;
  }

  if (options.requirePrompt && !process.stdin.isTTY) {
    const chunks: string[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk.toString());
    }
    return chunks.join("");
  }

  if (options.requirePrompt) {
    throw new Error(
      "Provide --prompt, --input-file, pipe content through stdin, or use --task-file with prompt/promptFile."
    );
  }

  return undefined;
}

function resolveLogPath(config: AppConfig, cwd: string): string | undefined {
  if (!config.logging.saveLogsToFile || !config.artifacts.saveLogs) {
    return undefined;
  }

  return path.resolve(
    cwd,
    config.artifacts.rootDir,
    `session-${Date.now()}.log`
  );
}

function createContext(
  configPath: string | undefined,
  cwd: string,
  jsonOutput = false
): Context {
  const { config, configPath: resolvedConfigPath } = loadConfig(configPath, cwd);
  const logger = new Logger({
    level: config.logging.level,
    filePath: resolveLogPath(config, cwd),
    consoleEnabled: !jsonOutput
  });
  const registry = new AgentRegistry(config, {
    processRunner: new ProcessRunner(),
    logger
  });
  const orchestrator = new Orchestrator(
    config,
    registry,
    new Router(config),
    new PromptBuilder(),
    logger
  );
  const batch = new BatchRunnerService(config, orchestrator);
  const preview = new PreviewService(
    config,
    registry,
    new Router(config),
    new PromptBuilder()
  );
  const validation = new ValidationService(config);
  const preflight = new PreflightService(
    config,
    registry,
    new Router(config),
    validation
  );
  const history = new ArtifactHistoryService(config);
  const configReport = new ConfigReportService(config, resolvedConfigPath);
  const doctor = new Doctor(config, registry);

  return {
    config,
    configPath: resolvedConfigPath,
    registry,
    orchestrator,
    batch,
    doctor,
    preview,
    preflight,
    history,
    configReport,
    validation,
    logger
  };
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printBatchRunReport(report: BatchRunReport): void {
  console.log(`planFile: ${report.planFilePath}`);
  console.log(`dryRun: ${report.dryRun}`);
  console.log(`continueOnError: ${report.continueOnError}`);
  console.log(
    `summary: succeeded=${report.succeededTasks} failed=${report.failedTasks} total=${report.totalTasks} stoppedEarly=${report.stoppedEarly}`
  );
  if (report.artifactPath) {
    console.log(`artifactPath: ${report.artifactPath}`);
  }
  if (report.retryPlanPath) {
    console.log(`retryPlanPath: ${report.retryPlanPath}`);
  }

  for (const result of report.results) {
    console.log(`${result.label ?? path.basename(result.taskFilePath)}: ${result.success ? "success" : "failed"}`);
    console.log(`  taskFile: ${result.taskFilePath}`);
    if (result.taskType) {
      console.log(`  taskType: ${result.taskType}`);
    }
    if (result.taskId) {
      console.log(`  taskId: ${result.taskId}`);
    }
    if (result.selectedAgent) {
      console.log(`  selectedAgent: ${result.selectedAgent}`);
    }
    if (result.artifactDir) {
      console.log(`  artifactDir: ${result.artifactDir}`);
    }
    if (result.error) {
      console.log(`  error: ${result.error}`);
    }
  }
}

function printTaskPreflightReport(report: TaskPreflightReport): void {
  console.log(`status: ${report.status}`);
  console.log(`taskId: ${report.task.id}`);
  console.log(`taskType: ${report.task.type}`);
  console.log(`availableAgents: ${report.availableAgents}`);
  console.log(`orderedAgents: ${report.route.orderedAgents.join(" -> ") || "(none)"}`);
  if (report.artifactPath) {
    console.log(`artifactPath: ${report.artifactPath}`);
  }
  for (const reason of report.reasons) {
    console.log(`reason: ${reason}`);
  }
  for (const action of report.recommendedActions) {
    console.log(`nextAction: ${action}`);
  }
}

function printBatchPreflightReport(report: BatchPreflightReport): void {
  console.log(`status: ${report.status}`);
  console.log(`planFile: ${report.planFilePath}`);
  console.log(
    `summary: ready=${report.summary.readyTasks} warning=${report.summary.warningTasks} blocked=${report.summary.blockedTasks} total=${report.summary.totalTasks}`
  );
  if (report.artifactPath) {
    console.log(`artifactPath: ${report.artifactPath}`);
  }
  for (const reason of report.reasons) {
    console.log(`reason: ${reason}`);
  }
  for (const action of report.recommendedActions) {
    console.log(`nextAction: ${action}`);
  }
  for (const task of report.tasks) {
    console.log(`${task.label ?? path.basename(task.taskFilePath)}: ${task.status}`);
    console.log(`  taskFile: ${task.taskFilePath}`);
    if (task.taskType) {
      console.log(`  taskType: ${task.taskType}`);
    }
    if (task.route) {
      console.log(`  orderedAgents: ${task.route.orderedAgents.join(" -> ") || "(none)"}`);
    }
    console.log(`  availableAgents: ${task.availableAgents}`);
    for (const reason of task.reasons) {
      console.log(`  reason: ${reason}`);
    }
  }
}

function shouldStopForPreflight(
  status: PreflightStatus,
  failOnWarning: boolean
): boolean {
  return status === "blocked" || (failOnWarning && status === "warning");
}

function printPreflightSummary(
  report: TaskPreflightReport | BatchPreflightReport
): void {
  console.log(`preflightStatus: ${report.status}`);
  if (report.artifactPath) {
    console.log(`preflightArtifactPath: ${report.artifactPath}`);
  }

  if (report.mode === "task") {
    console.log(
      `preflightRoute: ${report.route.orderedAgents.join(" -> ") || "(none)"}`
    );
    console.log(`preflightAvailableAgents: ${report.availableAgents}`);
  } else {
    console.log(
      `preflightSummary: ready=${report.summary.readyTasks} warning=${report.summary.warningTasks} blocked=${report.summary.blockedTasks} total=${report.summary.totalTasks}`
    );
  }

  for (const reason of report.reasons) {
    console.log(`preflightReason: ${reason}`);
  }
}

function parseAgentName(input: string): AgentName {
  if ((AGENT_NAMES as readonly string[]).includes(input)) {
    return input as AgentName;
  }

  throw new Error(`Unsupported agent "${input}". Expected one of: ${AGENT_NAMES.join(", ")}`);
}

function parseTaskType(input: string): Task["type"] {
  if ((TASK_TYPES as readonly string[]).includes(input)) {
    return input as Task["type"];
  }

  throw new Error(`Unsupported task type "${input}". Expected one of: ${TASK_TYPES.join(", ")}`);
}

function buildTaskFromCliOptions(options: {
  task?: string;
  agent?: string;
  cwd?: string;
  title?: string;
  fallback?: string[];
  timeoutMs?: string;
  prompt?: string;
  inputFile?: string;
  taskFile?: string;
  requirePrompt: boolean;
}): Promise<{ task: Task; taskFilePath?: string }> {
  return (async () => {
    const loaded = options.taskFile
      ? loadTaskFile(options.taskFile, options.cwd ?? process.cwd())
      : undefined;
    const resolvedCwd = path.resolve(
      options.cwd ?? loaded?.task.cwd ?? process.cwd()
    );
    const prompt = await resolvePromptFromSources({
      prompt: options.prompt,
      inputFile: options.inputFile,
      taskPrompt: loaded?.task.prompt,
      requirePrompt: options.requirePrompt
    });
    const preferredAgentSource =
      options.agent ?? loaded?.task.preferredAgent ?? "auto";
    const preferredAgent =
      preferredAgentSource === "auto"
        ? "auto"
        : parseAgentName(preferredAgentSource);
    const fallbackSource = options.fallback ?? loaded?.task.fallbackAgents ?? [];

    if (!options.task && !loaded?.task.type) {
      throw new Error("Provide --task or use --task-file with a type field.");
    }

    return {
      taskFilePath: loaded?.taskFilePath,
      task: {
        id: loaded?.task.id ?? randomUUID(),
        type: parseTaskType(options.task ?? loaded?.task.type ?? ""),
        title: options.title ?? loaded?.task.title,
        prompt: prompt ?? "",
        cwd: resolvedCwd,
        metadata: loaded?.task.metadata,
        preferredAgent,
        fallbackAgents: fallbackSource.map(parseAgentName),
        timeoutMs: options.timeoutMs
          ? Number(options.timeoutMs)
          : loaded?.task.timeoutMs
      }
    };
  })();
}

const program = new Command();
program
  .name("agent-orchestrator")
  .description("Windows-friendly local multi-agent CLI orchestrator")
  .version("0.1.0");

program
  .command("list")
  .description("List registered agent adapters and their configured command candidates.")
  .option("-c, --config <path>", "Path to a JSON/YAML config file.")
  .option("--cwd <path>", "Base working directory.", process.cwd())
  .option("--json", "Print JSON output.")
  .action((options: { config?: string; cwd: string; json?: boolean }) => {
    const context = createContext(
      options.config,
      path.resolve(options.cwd),
      Boolean(options.json)
    );
    const result = context.registry.list();
    if (options.json) {
      printJson(result);
      return;
    }

    for (const agent of result) {
      console.log(`${agent.name} (${agent.enabled ? "enabled" : "disabled"})`);
      console.log(`  candidates: ${agent.commandCandidates.join(", ")}`);
      for (const note of agent.notes) {
        console.log(`  note: ${note}`);
      }
    }
  });

program
  .command("config")
  .description("Show the effective merged config and which config file was loaded.")
  .option("-c, --config <path>", "Path to a JSON/YAML config file.")
  .option("--cwd <path>", "Base working directory.", process.cwd())
  .option("--agent <name>", `Limit output to one agent: ${AGENT_NAMES.join(", ")}`)
  .option("--json", "Print JSON output.")
  .action((options: {
    config?: string;
    cwd: string;
    agent?: string;
    json?: boolean;
  }) => {
    const context = createContext(
      options.config,
      path.resolve(options.cwd),
      Boolean(options.json)
    );
    const agentNames = options.agent ? [parseAgentName(options.agent)] : undefined;
    const report = context.configReport.inspect({ agentNames });

    if (options.json) {
      printJson(report);
      return;
    }

    console.log(`configPath: ${report.configPath ?? "(using built-in defaults)"}`);
    console.log(`usingDefaultConfig: ${report.usingDefaultConfig}`);
    console.log(
      `logging: level=${report.logging.level} saveLogsToFile=${report.logging.saveLogsToFile}`
    );
    console.log(
      `runtime: detectTimeoutMs=${report.runtime.detectTimeoutMs} maxPromptArgLength=${report.runtime.maxPromptArgLength}`
    );
    console.log(
      `artifacts: rootDir=${report.artifacts.rootDir} saveOutputs=${report.artifacts.saveOutputs} savePromptFiles=${report.artifacts.savePromptFiles} saveLogs=${report.artifacts.saveLogs}`
    );
    for (const taskType of TASK_TYPES) {
      console.log(`route.${taskType}: ${report.routing[taskType].join(" -> ")}`);
    }
    for (const agent of report.agents) {
      console.log(`${agent.name}: ${agent.enabled ? "enabled" : "disabled"}`);
      console.log(`  commandCandidates: ${agent.commandCandidates.join(", ")}`);
      if (agent.executablePath) {
        console.log(`  executablePath: ${agent.executablePath}`);
      }
      console.log(`  defaultArgs: ${agent.defaultArgs.join(" ") || "(none)"}`);
      console.log(`  inputModes: ${agent.inputModePriority.join(", ")}`);
      console.log(`  timeoutMs: ${agent.timeoutMs}`);
      console.log(`  retries: ${agent.retries}`);
      console.log(
        `  jsonModeArgs: ${agent.run.jsonModeArgs.join(" ") || "(none)"}`
      );
      console.log(
        `  nonInteractiveArgs: ${agent.run.nonInteractiveArgs.join(" ") || "(none)"}`
      );
      for (const note of agent.notes) {
        console.log(`  note: ${note}`);
      }
    }
  });

program
  .command("detect")
  .description("Probe configured agent CLIs from PATH or configured executable paths.")
  .option("-c, --config <path>", "Path to a JSON/YAML config file.")
  .option("--cwd <path>", "Base working directory.", process.cwd())
  .option("--json", "Print JSON output.")
  .action(async (options: { config?: string; cwd: string; json?: boolean }) => {
    const context = createContext(
      options.config,
      path.resolve(options.cwd),
      Boolean(options.json)
    );
    const result = await context.registry.detectAll();
    if (options.json) {
      printJson(result);
      return;
    }

    for (const agentName of AGENT_NAMES) {
      const detection = result[agentName];
      console.log(`${agentName}: ${detection.available ? "available" : "unavailable"}`);
      if (detection.executable) {
        console.log(`  executable: ${detection.executable}`);
      }
      if (detection.error) {
        console.log(`  error: ${detection.error}`);
      }
      for (const note of detection.notes) {
        console.log(`  note: ${note}`);
      }
    }
  });

program
  .command("doctor")
  .description("Show agent detection, configured run presets, and optional smoke-run results.")
  .option("-c, --config <path>", "Path to a JSON/YAML config file.")
  .option("--cwd <path>", "Base working directory.", process.cwd())
  .option("--agent <name>", `Limit to one agent: ${AGENT_NAMES.join(", ")}`)
  .option("--smoke", "Run a real non-interactive smoke prompt for each selected agent.")
  .option(
    "--fail-on-unhealthy",
    "Exit with code 1 when doctor reports warning/unhealthy status."
  )
  .option("--timeout-ms <ms>", "Smoke test timeout override.")
  .option("--json", "Print JSON output.")
  .action(async (options: {
    config?: string;
    cwd: string;
    agent?: string;
    smoke?: boolean;
    failOnUnhealthy?: boolean;
    timeoutMs?: string;
    json?: boolean;
  }) => {
    const cwd = path.resolve(options.cwd);
    const context = createContext(options.config, cwd, Boolean(options.json));
    const agentNames = options.agent ? [parseAgentName(options.agent)] : undefined;

    const report = await context.doctor.inspect({
      cwd,
      smoke: Boolean(options.smoke),
      agentNames,
      timeoutMs: options.timeoutMs ? Number(options.timeoutMs) : undefined
    });

    if (options.json) {
      printJson(report);
      if (options.failOnUnhealthy && report.summary.status !== "healthy") {
        process.exitCode = 1;
      }
      return;
    }

    console.log(`status: ${report.summary.status}`);
    console.log(
      `summary: healthy=${report.summary.healthyAgents} warning=${report.summary.warningAgents} unhealthy=${report.summary.unhealthyAgents} available=${report.summary.availableAgents} unavailable=${report.summary.unavailableAgents} smokeFailures=${report.summary.smokeFailures}`
    );
    if (report.artifactPath) {
      console.log(`artifactPath: ${report.artifactPath}`);
    }
    for (const action of report.summary.recommendedActions) {
      console.log(`nextAction: [${action.category}] ${action.message}`);
      if (action.command) {
        console.log(`  command: ${action.command}`);
      }
      if (action.configPath) {
        console.log(`  configPath: ${action.configPath}`);
      }
    }

    for (const agent of report.agents) {
      console.log(
        `${agent.agentName}: ${agent.status} (${agent.detection.available ? "available" : "unavailable"})`
      );
      console.log(`  enabled: ${agent.enabled}`);
      console.log(`  defaultArgs: ${agent.runPreset.defaultArgs.join(" ") || "(none)"}`);
      console.log(`  inputModes: ${agent.runPreset.inputModePriority.join(", ")}`);
      if (agent.detection.executable) {
        console.log(`  executable: ${agent.detection.executable}`);
      }
      if (agent.detection.error) {
        console.log(`  error: ${agent.detection.error}`);
      }
      for (const note of agent.detection.notes) {
        console.log(`  detectNote: ${note}`);
      }
      for (const reason of agent.reasons) {
        console.log(`  reason: ${reason}`);
      }
      for (const action of agent.recommendedActions) {
        console.log(`  nextAction: [${action.category}] ${action.message}`);
        if (action.command) {
          console.log(`    command: ${action.command}`);
        }
        if (action.configPath) {
          console.log(`    configPath: ${action.configPath}`);
        }
      }
      if (agent.smoke) {
        console.log(
          `  smoke: ${agent.smoke.success ? "success" : "failed"} exitCode=${agent.smoke.exitCode} timedOut=${agent.smoke.timedOut} durationMs=${agent.smoke.durationMs}`
        );
        if (agent.smoke.parsedFormat) {
          console.log(`  smokeParsed: ${agent.smoke.parsedFormat}`);
        }
      }
      for (const note of agent.runPreset.notes) {
        console.log(`  note: ${note}`);
      }
    }

    if (options.failOnUnhealthy && report.summary.status !== "healthy") {
      process.exitCode = 1;
    }
  });

program
  .command("route")
  .description("Preview router ordering and optional detection state without running any agent.")
  .option("--task <type>", `Task type: ${TASK_TYPES.join(", ")}`)
  .option("--task-file <path>", "Load a full task definition from a JSON/YAML file.")
  .option("--agent <name>", `Preferred agent or auto`)
  .option("--fallback <agents...>", "Fallback agents in order.")
  .option("--cwd <path>", "Task working directory.")
  .option("--title <text>", "Optional task title.")
  .option("--detect", "Include live adapter detection details for routed agents.")
  .option("-c, --config <path>", "Path to a JSON/YAML config file.")
  .option("--json", "Print JSON output.")
  .action(async (options: {
    task: string;
    taskFile?: string;
    agent?: string;
    fallback?: string[];
    cwd?: string;
    title?: string;
    detect?: boolean;
    config?: string;
    json?: boolean;
  }) => {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const context = createContext(options.config, cwd, Boolean(options.json));
    const { task, taskFilePath } = await buildTaskFromCliOptions({
      task: options.task,
      taskFile: options.taskFile,
      agent: options.agent,
      fallback: options.fallback,
      cwd: options.cwd,
      title: options.title,
      requirePrompt: false
    });

    const report = await context.preview.inspectRoute(task, {
      includeDetection: Boolean(options.detect)
    });

    if (options.json) {
      printJson(report);
      return;
    }

    console.log(`taskId: ${report.task.id}`);
    console.log(`taskType: ${report.task.type}`);
    console.log(`orderedAgents: ${report.route.orderedAgents.join(" -> ") || "(none)"}`);
    if (taskFilePath) {
      console.log(`taskFile: ${taskFilePath}`);
    }
    if (report.artifactPath) {
      console.log(`artifactPath: ${report.artifactPath}`);
    }
    for (const reason of report.route.reasons) {
      console.log(`reason: ${reason}`);
    }
    for (const agent of report.agents) {
      console.log(`${agent.agentName}: ${agent.enabled ? "enabled" : "disabled"}`);
      if (agent.detection) {
        console.log(
          `  detection: ${agent.detection.available ? "available" : "unavailable"}`
        );
        if (agent.detection.executable) {
          console.log(`  executable: ${agent.detection.executable}`);
        }
        if (agent.detection.error) {
          console.log(`  error: ${agent.detection.error}`);
        }
      }
      for (const note of agent.configNotes) {
        console.log(`  note: ${note}`);
      }
      for (const note of agent.detection?.notes ?? []) {
        console.log(`  detectNote: ${note}`);
      }
    }
  });

program
  .command("prompt")
  .description("Preview the final orchestrator prompt without running any agent.")
  .option("--task <type>", `Task type: ${TASK_TYPES.join(", ")}`)
  .option("--task-file <path>", "Load a full task definition from a JSON/YAML file.")
  .option("--agent <name>", `Preferred agent or auto`)
  .option("--cwd <path>", "Task working directory.")
  .option("--title <text>", "Optional task title.")
  .option("--prompt <text>", "Prompt text supplied directly.")
  .option("--input-file <path>", "Read prompt text from a file.")
  .option("--fallback <agents...>", "Fallback agents in order.")
  .option("--timeout-ms <ms>", "Task-level timeout override.")
  .option("-c, --config <path>", "Path to a JSON/YAML config file.")
  .option("--json", "Print JSON output.")
  .action(async (options: {
    task: string;
    taskFile?: string;
    agent?: string;
    cwd?: string;
    title?: string;
    prompt?: string;
    inputFile?: string;
    fallback?: string[];
    timeoutMs?: string;
    config?: string;
    json?: boolean;
  }) => {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const context = createContext(options.config, cwd, Boolean(options.json));
    const { task, taskFilePath } = await buildTaskFromCliOptions({
      task: options.task,
      taskFile: options.taskFile,
      agent: options.agent,
      fallback: options.fallback,
      cwd: options.cwd,
      title: options.title,
      timeoutMs: options.timeoutMs,
      prompt: options.prompt,
      inputFile: options.inputFile,
      requirePrompt: true
    });

    const report = await context.preview.previewPrompt(task);

    if (options.json) {
      printJson(report);
      return;
    }

    console.log(`taskId: ${report.task.id}`);
    console.log(`taskType: ${report.task.type}`);
    console.log(`promptLength: ${report.promptLength}`);
    console.log(`orderedAgents: ${report.route.orderedAgents.join(" -> ") || "(none)"}`);
    if (taskFilePath) {
      console.log(`taskFile: ${taskFilePath}`);
    }
    if (report.artifactPath) {
      console.log(`artifactPath: ${report.artifactPath}`);
    }
    if (report.promptArtifactPath) {
      console.log(`promptArtifactPath: ${report.promptArtifactPath}`);
    }
    console.log(report.prompt);
  });

program
  .command("preflight")
  .description("Run validation plus route-readiness checks for a task or batch plan.")
  .option("--task <type>", `Task type: ${TASK_TYPES.join(", ")}`)
  .option("--task-file <path>", "Load a full task definition from a JSON/YAML file.")
  .option("--plan-file <path>", "Load a JSON/YAML batch plan file for batch preflight.")
  .option("--agent <name>", `Preferred agent or auto`)
  .option("--fallback <agents...>", "Fallback agents in order.")
  .option("--cwd <path>", "Base working directory.", process.cwd())
  .option("--title <text>", "Optional task title.")
  .option("--prompt <text>", "Prompt text supplied directly.")
  .option("--input-file <path>", "Read prompt text from a file.")
  .option("--timeout-ms <ms>", "Task-level timeout override.")
  .option("--skip-detect", "Skip live agent detection and only inspect config/routing.")
  .option("--fail-on-blocked", "Exit with code 1 when preflight status is blocked.")
  .option("-c, --config <path>", "Path to a JSON/YAML config file.")
  .option("--json", "Print JSON output.")
  .action(async (options: {
    task?: string;
    taskFile?: string;
    planFile?: string;
    agent?: string;
    fallback?: string[];
    cwd: string;
    title?: string;
    prompt?: string;
    inputFile?: string;
    timeoutMs?: string;
    skipDetect?: boolean;
    failOnBlocked?: boolean;
    config?: string;
    json?: boolean;
  }) => {
    const cwd = path.resolve(options.cwd);
    const context = createContext(options.config, cwd, Boolean(options.json));

    if (options.planFile && (options.task || options.taskFile || options.prompt || options.inputFile)) {
      throw new Error(
        "Use --plan-file by itself, or use task/task-file inputs for task preflight."
      );
    }

    const includeDetection = !options.skipDetect;
    if (options.planFile) {
      const plan = loadBatchPlan(options.planFile, cwd);
      const report = await context.preflight.inspectBatch(plan, {
        includeDetection,
        artifactCwd: cwd
      });

      if (options.json) {
        printJson(report);
      } else {
        printBatchPreflightReport(report);
      }

      if (options.failOnBlocked && report.status === "blocked") {
        process.exitCode = 1;
      }
      return;
    }

    const { task, taskFilePath } = await buildTaskFromCliOptions({
      task: options.task,
      taskFile: options.taskFile,
      agent: options.agent,
      fallback: options.fallback,
      cwd: options.cwd,
      title: options.title,
      timeoutMs: options.timeoutMs,
      prompt: options.prompt,
      inputFile: options.inputFile,
      requirePrompt: true
    });
    const report = await context.preflight.inspectTask(task, {
      taskFilePath,
      includeDetection,
      artifactCwd: cwd
    });

    if (options.json) {
      printJson(report);
    } else {
      printTaskPreflightReport(report);
    }

    if (options.failOnBlocked && report.status === "blocked") {
      process.exitCode = 1;
    }
  });

program
  .command("history")
  .description("List recent doctor, preview, preflight, validation, batch, and run artifacts.")
  .option("--cwd <path>", "Base working directory.", process.cwd())
  .option(
    "--kind <kind>",
    `Artifact kind filter: ${HISTORY_KINDS.join(", ")}`,
    "all"
  )
  .option("--limit <count>", "Maximum number of entries to return.", "20")
  .option("-c, --config <path>", "Path to a JSON/YAML config file.")
  .option("--json", "Print JSON output.")
  .action((options: {
    cwd: string;
    kind: string;
    limit: string;
    config?: string;
    json?: boolean;
  }) => {
    const cwd = path.resolve(options.cwd);
    const context = createContext(options.config, cwd, Boolean(options.json));

    if (!(HISTORY_KINDS as readonly string[]).includes(options.kind)) {
      throw new Error(
        `Unsupported history kind "${options.kind}". Expected one of: ${HISTORY_KINDS.join(", ")}`
      );
    }

    const report = context.history.list({
      cwd,
      kind: options.kind as (typeof HISTORY_KINDS)[number],
      limit: Number(options.limit)
    });

    if (options.json) {
      printJson(report);
      return;
    }

    console.log(`rootDir: ${report.rootDir}`);
    console.log(`filter: ${report.filter}`);
    console.log(`returned: ${report.returnedEntries}/${report.totalEntries}`);

    for (const entry of report.entries) {
      console.log(`${entry.kind}: ${entry.createdAt}`);
      console.log(`  summary: ${entry.summary}`);
      console.log(`  path: ${entry.path}`);
      if (entry.status) {
        console.log(`  status: ${entry.status}`);
      }
      if (entry.taskType) {
        console.log(`  taskType: ${entry.taskType}`);
      }
      if (entry.selectedAgent) {
        console.log(`  selectedAgent: ${entry.selectedAgent}`);
      }
    }
  });

program
  .command("validate")
  .description("Validate config files, task files, and batch plans without running any agent.")
  .option("--cwd <path>", "Base working directory.", process.cwd())
  .option("-c, --config-file <path>", "Validate a specific JSON/YAML config file.")
  .option("--task-file <path>", "Validate a specific JSON/YAML task file.")
  .option("--plan-file <path>", "Validate a specific JSON/YAML batch plan file.")
  .option("--json", "Print JSON output.")
  .option("--fail-on-error", "Exit with code 1 when any validation target is invalid.")
  .action((options: {
    cwd: string;
    configFile?: string;
    taskFile?: string;
    planFile?: string;
    json?: boolean;
    failOnError?: boolean;
  }) => {
    const cwd = path.resolve(options.cwd);
    const context = createContext(undefined, cwd, Boolean(options.json));
    const results = [];

    if (options.configFile || (!options.taskFile && !options.planFile)) {
      results.push(context.validation.validateConfig(options.configFile, cwd));
    }

    if (options.taskFile) {
      results.push(context.validation.validateTaskFile(options.taskFile, cwd));
    }

    if (options.planFile) {
      results.push(...context.validation.validateBatchTargets(options.planFile, cwd));
    }

    const report = context.validation.buildReport(results, {
      artifactCwd: cwd
    });

    if (options.json) {
      printJson(report);
      if (options.failOnError && !report.allValid) {
        process.exitCode = 1;
      }
      return;
    }

    console.log(`allValid: ${report.allValid}`);
    if (report.artifactPath) {
      console.log(`artifactPath: ${report.artifactPath}`);
    }
    for (const result of report.results) {
      console.log(`${result.kind}: ${result.valid ? "valid" : "invalid"}`);
      if (result.path) {
        console.log(`  path: ${result.path}`);
      }
      console.log(`  summary: ${result.summary}`);
      if (result.details) {
        console.log(`  details: ${result.details}`);
      }
    }

    if (options.failOnError && !report.allValid) {
      process.exitCode = 1;
    }
  });

program
  .command("batch")
  .description("Run a batch plan that references multiple task files.")
  .requiredOption("--plan-file <path>", "Path to a JSON/YAML batch plan file.")
  .option("--cwd <path>", "Base working directory.", process.cwd())
  .option("--dry-run", "Build commands and orchestration flow without launching agent processes.")
  .option("--preflight", "Run preflight before batch execution and stop on blocked status.")
  .option(
    "--skip-preflight-detect",
    "When using --preflight, skip live agent detection and only inspect config/routing."
  )
  .option(
    "--fail-on-preflight-warning",
    "When using --preflight, also stop when preflight status is warning."
  )
  .option("--fail-on-error", "Exit with code 1 if any task in the batch fails.")
  .option("-c, --config <path>", "Path to a JSON/YAML config file.")
  .option("--json", "Print JSON output.")
  .action(async (options: {
    planFile: string;
    cwd: string;
    dryRun?: boolean;
    preflight?: boolean;
    skipPreflightDetect?: boolean;
    failOnPreflightWarning?: boolean;
    failOnError?: boolean;
    config?: string;
    json?: boolean;
  }) => {
    const cwd = path.resolve(options.cwd);
    const context = createContext(options.config, cwd, Boolean(options.json));
    const plan = loadBatchPlan(options.planFile, cwd);
    const preflight = options.preflight
      ? await context.preflight.inspectBatch(plan, {
          includeDetection: !options.skipPreflightDetect,
          artifactCwd: cwd
        })
      : undefined;

    if (preflight && shouldStopForPreflight(preflight.status, Boolean(options.failOnPreflightWarning))) {
      const output = {
        preflight,
        skipped: true,
        skipReason:
          preflight.status === "blocked"
            ? "Batch execution was skipped because preflight status is blocked."
            : "Batch execution was skipped because preflight status is warning and fail-on-preflight-warning is enabled."
      };

      if (options.json) {
        printJson(output);
      } else {
        printPreflightSummary(preflight);
        console.log(`skipReason: ${output.skipReason}`);
      }

      process.exitCode = 1;
      return;
    }

    const report = await context.batch.runPlan(plan, {
      dryRun: Boolean(options.dryRun),
      artifactCwd: cwd
    });

    if (options.json) {
      printJson(preflight ? { preflight, report } : report);
      if (options.failOnError && report.failedTasks > 0) {
        process.exitCode = 1;
      }
      return;
    }

    if (preflight) {
      printPreflightSummary(preflight);
    }
    printBatchRunReport(report);

    if (options.failOnError && report.failedTasks > 0) {
      process.exitCode = 1;
    }
  });

program
  .command("retry")
  .description("Re-run a retry batch plan directly, from a batch report, or from the latest failed batch.")
  .option("--retry-plan <path>", "Path to a retry batch plan YAML file.")
  .option("--report-file <path>", "Path to a batch JSON report with retryPlanPath.")
  .option("--latest-failed", "Use the most recent failed batch report from artifacts/.")
  .option("--cwd <path>", "Base working directory.", process.cwd())
  .option("--dry-run", "Build commands and orchestration flow without launching agent processes.")
  .option("--preflight", "Run preflight before retry execution and stop on blocked status.")
  .option(
    "--skip-preflight-detect",
    "When using --preflight, skip live agent detection and only inspect config/routing."
  )
  .option(
    "--fail-on-preflight-warning",
    "When using --preflight, also stop when preflight status is warning."
  )
  .option("--fail-on-error", "Exit with code 1 if any task in the retry batch fails.")
  .option("-c, --config <path>", "Path to a JSON/YAML config file.")
  .option("--json", "Print JSON output.")
  .action(async (options: {
    retryPlan?: string;
    reportFile?: string;
    latestFailed?: boolean;
    cwd: string;
    dryRun?: boolean;
    preflight?: boolean;
    skipPreflightDetect?: boolean;
    failOnPreflightWarning?: boolean;
    failOnError?: boolean;
    config?: string;
    json?: boolean;
  }) => {
    const cwd = path.resolve(options.cwd);
    const context = createContext(options.config, cwd, Boolean(options.json));
    const activeSources = [options.retryPlan, options.reportFile, options.latestFailed ? "latest" : undefined]
      .filter((value) => value !== undefined);

    if (activeSources.length !== 1) {
      throw new Error(
        "Provide exactly one of --retry-plan, --report-file, or --latest-failed."
      );
    }

      const resolution = options.retryPlan
        ? {
            retryPlanPath: path.resolve(cwd, options.retryPlan),
            source: "retry_plan" as const
          }
        : options.reportFile
          ? resolveRetryPlanFromBatchReport(options.reportFile, cwd)
          : resolveLatestFailedRetryPlan(context.config, cwd);
    const plan = loadBatchPlan(resolution.retryPlanPath, cwd);
    const preflight = options.preflight
      ? await context.preflight.inspectBatch(plan, {
          includeDetection: !options.skipPreflightDetect,
          artifactCwd: cwd
        })
      : undefined;

    if (preflight && shouldStopForPreflight(preflight.status, Boolean(options.failOnPreflightWarning))) {
      const output = {
        source: resolution.source,
        sourceReportPath: "sourceReportPath" in resolution ? resolution.sourceReportPath : undefined,
        retryPlanPath: resolution.retryPlanPath,
        preflight,
        skipped: true,
        skipReason:
          preflight.status === "blocked"
            ? "Retry execution was skipped because preflight status is blocked."
            : "Retry execution was skipped because preflight status is warning and fail-on-preflight-warning is enabled."
      };

      if (options.json) {
        printJson(output);
      } else {
        console.log(`source: ${output.source}`);
        if (output.sourceReportPath) {
          console.log(`sourceReportPath: ${output.sourceReportPath}`);
        }
        console.log(`retryPlanPath: ${output.retryPlanPath}`);
        printPreflightSummary(preflight);
        console.log(`skipReason: ${output.skipReason}`);
      }

      process.exitCode = 1;
      return;
    }

    const report = await context.batch.runPlan(plan, {
      dryRun: Boolean(options.dryRun),
      artifactCwd: cwd
    });
    const output = {
      source: resolution.source,
      sourceReportPath: "sourceReportPath" in resolution ? resolution.sourceReportPath : undefined,
      retryPlanPath: resolution.retryPlanPath,
      preflight,
      report
    };

    if (options.json) {
      printJson(output);
      if (options.failOnError && report.failedTasks > 0) {
        process.exitCode = 1;
      }
      return;
    }

    console.log(`source: ${output.source}`);
    if (output.sourceReportPath) {
      console.log(`sourceReportPath: ${output.sourceReportPath}`);
    }
    console.log(`retryPlanPath: ${output.retryPlanPath}`);
    if (preflight) {
      printPreflightSummary(preflight);
    }
    printBatchRunReport(report);

    if (options.failOnError && report.failedTasks > 0) {
      process.exitCode = 1;
    }
  });

program
  .command("run")
  .description("Run a task through the router/orchestrator.")
  .option("--task <type>", `Task type: ${TASK_TYPES.join(", ")}`)
  .option("--task-file <path>", "Load a full task definition from a JSON/YAML file.")
  .option("--agent <name>", `Preferred agent or auto`)
  .option("--cwd <path>", "Task working directory.")
  .option("--title <text>", "Optional task title.")
  .option("--prompt <text>", "Prompt text supplied directly.")
  .option("--input-file <path>", "Read prompt text from a file.")
  .option("--fallback <agents...>", "Fallback agents in order.")
  .option("--timeout-ms <ms>", "Task-level timeout override.")
  .option("-c, --config <path>", "Path to a JSON/YAML config file.")
  .option("--json", "Print JSON output.")
  .option("--dry-run", "Build route and commands without launching the agent process.")
  .option("--preflight", "Run preflight before task execution and stop on blocked status.")
  .option(
    "--skip-preflight-detect",
    "When using --preflight, skip live agent detection and only inspect config/routing."
  )
  .option(
    "--fail-on-preflight-warning",
    "When using --preflight, also stop when preflight status is warning."
  )
  .action(
    async (options: {
      task: string;
      taskFile?: string;
      agent?: string;
      cwd?: string;
      title?: string;
      prompt?: string;
      inputFile?: string;
      fallback?: string[];
      timeoutMs?: string;
      config?: string;
      json?: boolean;
      dryRun?: boolean;
      preflight?: boolean;
      skipPreflightDetect?: boolean;
      failOnPreflightWarning?: boolean;
    }) => {
      const cwd = path.resolve(options.cwd ?? process.cwd());
      const context = createContext(options.config, cwd, Boolean(options.json));
      const { task, taskFilePath } = await buildTaskFromCliOptions({
        task: options.task,
        taskFile: options.taskFile,
        agent: options.agent,
        fallback: options.fallback,
        cwd: options.cwd,
        title: options.title,
        timeoutMs: options.timeoutMs,
        prompt: options.prompt,
        inputFile: options.inputFile,
        requirePrompt: true
      });
      const preflight = options.preflight
        ? await context.preflight.inspectTask(task, {
            taskFilePath,
            includeDetection: !options.skipPreflightDetect,
            artifactCwd: cwd
          })
        : undefined;

      if (preflight && shouldStopForPreflight(preflight.status, Boolean(options.failOnPreflightWarning))) {
        const output = {
          preflight,
          skipped: true,
          skipReason:
            preflight.status === "blocked"
              ? "Task execution was skipped because preflight status is blocked."
              : "Task execution was skipped because preflight status is warning and fail-on-preflight-warning is enabled."
        };

        if (options.json) {
          printJson(output);
        } else {
          printPreflightSummary(preflight);
          console.log(`skipReason: ${output.skipReason}`);
        }

        process.exitCode = 1;
        return;
      }

      const result = await context.orchestrator.run(task, {
        dryRun: Boolean(options.dryRun)
      });

      if (options.json) {
        printJson(preflight ? { preflight, result } : result);
        return;
      }

      if (preflight) {
        printPreflightSummary(preflight);
      }
      console.log(`taskId: ${result.taskId}`);
      console.log(`success: ${result.success}`);
      console.log(`selectedAgent: ${result.selectedAgent ?? "none"}`);
      if (taskFilePath) {
        console.log(`taskFile: ${taskFilePath}`);
      }
      console.log(`artifactDir: ${result.artifactDir}`);

      for (const attempt of result.attempts) {
        console.log(`- ${attempt.agentName}: ${attempt.success ? "success" : "failed"} (${attempt.reason})`);
        if (attempt.result?.commandLine) {
          console.log(`  command: ${attempt.result.commandLine}`);
        }
        if (attempt.result?.parsed?.data) {
          console.log(`  parsed: ${JSON.stringify(attempt.result.parsed.data)}`);
        }
      }
    }
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
