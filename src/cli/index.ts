#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { Command } from "commander";

import { AgentRegistry } from "../agents/registry";
import { loadConfig } from "../config/load-config";
import { AppConfig } from "../config/schema";
import { Orchestrator } from "../core/orchestrator";
import { Doctor } from "../core/doctor";
import { PreviewService } from "../core/preview";
import { PromptBuilder } from "../core/prompt-builder";
import { Router } from "../core/router";
import { AGENT_NAMES, AgentName, TASK_TYPES, Task } from "../core/task";
import { ProcessRunner } from "../process/process-runner";
import { readTextFile } from "../utils/fs";
import { Logger } from "../utils/logger";

interface Context {
  config: AppConfig;
  registry: AgentRegistry;
  orchestrator: Orchestrator;
  doctor: Doctor;
  preview: PreviewService;
  logger: Logger;
}

async function readPrompt(prompt?: string, inputFile?: string): Promise<string> {
  if (prompt) {
    return prompt;
  }

  if (inputFile) {
    return readTextFile(path.resolve(inputFile));
  }

  if (!process.stdin.isTTY) {
    const chunks: string[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk.toString());
    }
    return chunks.join("");
  }

  throw new Error("Provide --prompt, --input-file, or pipe content through stdin.");
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
  const { config } = loadConfig(configPath, cwd);
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
  const preview = new PreviewService(
    config,
    registry,
    new Router(config),
    new PromptBuilder()
  );
  const doctor = new Doctor(config, registry);

  return {
    config,
    registry,
    orchestrator,
    doctor,
    preview,
    logger
  };
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
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
  task: string;
  agent: string;
  cwd: string;
  title?: string;
  fallback?: string[];
  timeoutMs?: string;
  prompt: string;
}): Task {
  const preferredAgent =
    options.agent === "auto" ? "auto" : parseAgentName(options.agent);
  const fallbackAgents = (options.fallback ?? []).map(parseAgentName);

  return {
    id: randomUUID(),
    type: parseTaskType(options.task),
    title: options.title,
    prompt: options.prompt,
    cwd: options.cwd,
    preferredAgent,
    fallbackAgents,
    timeoutMs: options.timeoutMs ? Number(options.timeoutMs) : undefined
  };
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
  .requiredOption("--task <type>", `Task type: ${TASK_TYPES.join(", ")}`)
  .option("--agent <name>", `Preferred agent or auto`, "auto")
  .option("--fallback <agents...>", "Fallback agents in order.")
  .option("--cwd <path>", "Task working directory.", process.cwd())
  .option("--title <text>", "Optional task title.")
  .option("--detect", "Include live adapter detection details for routed agents.")
  .option("-c, --config <path>", "Path to a JSON/YAML config file.")
  .option("--json", "Print JSON output.")
  .action(async (options: {
    task: string;
    agent: string;
    fallback?: string[];
    cwd: string;
    title?: string;
    detect?: boolean;
    config?: string;
    json?: boolean;
  }) => {
    const cwd = path.resolve(options.cwd);
    const context = createContext(options.config, cwd, Boolean(options.json));
    const task = buildTaskFromCliOptions({
      task: options.task,
      agent: options.agent,
      fallback: options.fallback,
      cwd,
      title: options.title,
      prompt: ""
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
  .requiredOption("--task <type>", `Task type: ${TASK_TYPES.join(", ")}`)
  .option("--agent <name>", `Preferred agent or auto`, "auto")
  .option("--cwd <path>", "Task working directory.", process.cwd())
  .option("--title <text>", "Optional task title.")
  .option("--prompt <text>", "Prompt text supplied directly.")
  .option("--input-file <path>", "Read prompt text from a file.")
  .option("--fallback <agents...>", "Fallback agents in order.")
  .option("--timeout-ms <ms>", "Task-level timeout override.")
  .option("-c, --config <path>", "Path to a JSON/YAML config file.")
  .option("--json", "Print JSON output.")
  .action(async (options: {
    task: string;
    agent: string;
    cwd: string;
    title?: string;
    prompt?: string;
    inputFile?: string;
    fallback?: string[];
    timeoutMs?: string;
    config?: string;
    json?: boolean;
  }) => {
    const cwd = path.resolve(options.cwd);
    const prompt = await readPrompt(options.prompt, options.inputFile);
    const context = createContext(options.config, cwd, Boolean(options.json));
    const task = buildTaskFromCliOptions({
      task: options.task,
      agent: options.agent,
      fallback: options.fallback,
      cwd,
      title: options.title,
      timeoutMs: options.timeoutMs,
      prompt
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
    if (report.artifactPath) {
      console.log(`artifactPath: ${report.artifactPath}`);
    }
    if (report.promptArtifactPath) {
      console.log(`promptArtifactPath: ${report.promptArtifactPath}`);
    }
    console.log(report.prompt);
  });

program
  .command("run")
  .description("Run a task through the router/orchestrator.")
  .requiredOption("--task <type>", `Task type: ${TASK_TYPES.join(", ")}`)
  .option("--agent <name>", `Preferred agent or auto`, "auto")
  .option("--cwd <path>", "Task working directory.", process.cwd())
  .option("--title <text>", "Optional task title.")
  .option("--prompt <text>", "Prompt text supplied directly.")
  .option("--input-file <path>", "Read prompt text from a file.")
  .option("--fallback <agents...>", "Fallback agents in order.")
  .option("--timeout-ms <ms>", "Task-level timeout override.")
  .option("-c, --config <path>", "Path to a JSON/YAML config file.")
  .option("--json", "Print JSON output.")
  .option("--dry-run", "Build route and commands without launching the agent process.")
  .action(
    async (options: {
      task: string;
      agent: string;
      cwd: string;
      title?: string;
      prompt?: string;
      inputFile?: string;
      fallback?: string[];
      timeoutMs?: string;
      config?: string;
      json?: boolean;
      dryRun?: boolean;
    }) => {
      const cwd = path.resolve(options.cwd);
      const prompt = await readPrompt(options.prompt, options.inputFile);
      const context = createContext(options.config, cwd, Boolean(options.json));
      const task = buildTaskFromCliOptions({
        task: options.task,
        agent: options.agent,
        fallback: options.fallback,
        cwd,
        title: options.title,
        timeoutMs: options.timeoutMs,
        prompt
      });

      const result = await context.orchestrator.run(task, {
        dryRun: Boolean(options.dryRun)
      });

      if (options.json) {
        printJson(result);
        return;
      }

      console.log(`taskId: ${result.taskId}`);
      console.log(`success: ${result.success}`);
      console.log(`selectedAgent: ${result.selectedAgent ?? "none"}`);
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
