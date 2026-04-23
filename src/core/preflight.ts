import path from "node:path";

import { AgentDetectionResult } from "../agents/base";
import { AgentRegistry } from "../agents/registry";
import { AppConfig } from "../config/schema";
import { writeJsonFile } from "../utils/fs";
import { LoadedBatchPlan } from "./batch";
import { Router } from "./router";
import { loadTaskFile } from "./task-file";
import { AgentName, RouteDecision, Task } from "./task";
import {
  ValidationReport,
  ValidationResult,
  ValidationService
} from "./validation";

export const PREFLIGHT_STATUSES = ["ready", "warning", "blocked"] as const;
export type PreflightStatus = (typeof PREFLIGHT_STATUSES)[number];

export interface PreflightAgentCheck {
  agentName: AgentName;
  enabled: boolean;
  configNotes: string[];
  detection?: AgentDetectionResult;
}

export interface TaskPreflightReport {
  generatedAt: string;
  mode: "task";
  status: PreflightStatus;
  includeDetection: boolean;
  task: {
    id: string;
    type: Task["type"];
    title?: string;
    cwd: string;
    preferredAgent: Task["preferredAgent"];
    fallbackAgents: AgentName[];
  };
  validation: ValidationReport;
  route: RouteDecision;
  agents: PreflightAgentCheck[];
  availableAgents: number;
  reasons: string[];
  recommendedActions: string[];
  artifactPath?: string;
}

export interface BatchPreflightTaskReport {
  label?: string;
  taskFilePath: string;
  taskId?: string;
  taskType?: Task["type"];
  status: PreflightStatus;
  validation: ValidationResult;
  route?: RouteDecision;
  agents: PreflightAgentCheck[];
  availableAgents: number;
  reasons: string[];
}

export interface BatchPreflightReport {
  generatedAt: string;
  mode: "batch";
  status: PreflightStatus;
  includeDetection: boolean;
  planFilePath: string;
  validation: ValidationReport;
  summary: {
    totalTasks: number;
    readyTasks: number;
    warningTasks: number;
    blockedTasks: number;
  };
  tasks: BatchPreflightTaskReport[];
  reasons: string[];
  recommendedActions: string[];
  artifactPath?: string;
}

interface PreflightOptions {
  includeDetection?: boolean;
  artifactCwd?: string;
}

function sanitizePathToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "-");
}

function toTaskSummary(task: Task): TaskPreflightReport["task"] {
  return {
    id: task.id,
    type: task.type,
    title: task.title,
    cwd: task.cwd,
    preferredAgent: task.preferredAgent ?? "auto",
    fallbackAgents: [...(task.fallbackAgents ?? [])]
  };
}

function buildInlineTaskValidation(task: Task): ValidationResult {
  const hasPrompt = task.prompt.trim().length > 0;

  return {
    kind: "task",
    valid: hasPrompt,
    summary: hasPrompt
      ? `Inline task is valid for type=${task.type}.`
      : "Task preflight requires a prompt.",
    details: hasPrompt ? `promptLength=${task.prompt.length}` : "Provide --prompt, --input-file, or a task-file prompt."
  };
}

function buildRecommendedActions(
  status: PreflightStatus,
  route: RouteDecision | undefined,
  validation: ValidationReport,
  includeDetection: boolean,
  availableAgents: number,
  scope: { taskFilePath?: string; planFilePath?: string }
): string[] {
  const actions: string[] = [];

  if (!validation.allValid) {
    if (scope.taskFilePath) {
      actions.push(`Fix ${scope.taskFilePath} before running this task.`);
    } else if (scope.planFilePath) {
      actions.push(`Fix invalid task files referenced by ${scope.planFilePath} before batch execution.`);
    } else {
      actions.push("Fix invalid task input before running.");
    }
  }

  if (includeDetection && availableAgents === 0) {
    const agentChain = route?.orderedAgents.join(" ");
    actions.push(
      `No routed agents are currently available. Run doctor${agentChain ? ` --agent ${route?.orderedAgents[0]}` : ""} or adjust config.`
    );
  } else if (status === "warning" && route?.orderedAgents.length) {
    actions.push(
      `Primary route is partially degraded. Consider checking doctor for ${route.orderedAgents[0]}.`
    );
  }

  if (actions.length === 0 && status === "ready") {
    actions.push("Preflight looks good. You can proceed with run, batch, or retry.");
  }

  return actions;
}

async function buildAgentChecks(
  config: AppConfig,
  registry: AgentRegistry,
  orderedAgents: AgentName[],
  includeDetection: boolean
): Promise<PreflightAgentCheck[]> {
  const checks: PreflightAgentCheck[] = [];

  for (const agentName of orderedAgents) {
    const adapter = registry.get(agentName);
    checks.push({
      agentName,
      enabled: config.agents[agentName].enabled,
      configNotes: [...config.agents[agentName].notes],
      detection: includeDetection && adapter ? await adapter.detect() : undefined
    });
  }

  return checks;
}

function deriveStatus(
  validation: ValidationReport,
  agents: PreflightAgentCheck[],
  includeDetection: boolean
): {
  status: PreflightStatus;
  availableAgents: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  const enabledAgents = agents.filter((agent) => agent.enabled).length;

  if (!validation.allValid) {
    reasons.push("Validation reported at least one invalid target.");
  }

  if (enabledAgents === 0) {
    reasons.push("No routed agents are enabled in config.");
  }

  if (!includeDetection) {
    if (!validation.allValid || enabledAgents === 0) {
      return {
        status: "blocked",
        availableAgents: enabledAgents,
        reasons
      };
    }

    if (enabledAgents < agents.length) {
      reasons.push("Some routed agents are disabled in config.");
      return {
        status: "warning",
        availableAgents: enabledAgents,
        reasons
      };
    }

    return {
      status: "ready",
      availableAgents: enabledAgents,
      reasons: reasons.length > 0 ? reasons : ["Route and config look consistent."]
    };
  }

  const availableAgents = agents.filter((agent) => agent.detection?.available).length;
  if (availableAgents === 0) {
    reasons.push("No routed agents are currently detectable.");
  }

  if (!validation.allValid || enabledAgents === 0 || availableAgents === 0) {
    return {
      status: "blocked",
      availableAgents,
      reasons
    };
  }

  const firstAgent = agents[0];
  if (availableAgents < agents.length) {
    reasons.push("Some fallback agents are unavailable.");
  }
  if (firstAgent && !firstAgent.detection?.available) {
    reasons.push("Primary routed agent is unavailable; execution will depend on fallback.");
  }

  if (reasons.length > 0) {
    return {
      status: "warning",
      availableAgents,
      reasons
    };
  }

  return {
    status: "ready",
    availableAgents,
    reasons: ["Validation passed and routed agents are available."]
  };
}

export class PreflightService {
  public constructor(
    private readonly config: AppConfig,
    private readonly registry: AgentRegistry,
    private readonly router: Router,
    private readonly validation: ValidationService
  ) {}

  public async inspectTask(
    task: Task,
    options?: PreflightOptions & { taskFilePath?: string }
  ): Promise<TaskPreflightReport> {
    const includeDetection = options?.includeDetection !== false;
    const validationResults = options?.taskFilePath
      ? [this.validation.validateTaskFile(options.taskFilePath, task.cwd)]
      : [buildInlineTaskValidation(task)];
    const validation = this.validation.buildReport(validationResults);
    const route = this.router.select(task);
    const agents = await buildAgentChecks(
      this.config,
      this.registry,
      route.orderedAgents,
      includeDetection
    );
    const derived = deriveStatus(validation, agents, includeDetection);
    const artifactRoot = path.resolve(options?.artifactCwd ?? task.cwd);
    const artifactPath = this.config.artifacts.saveOutputs
      ? path.resolve(
          artifactRoot,
          this.config.artifacts.rootDir,
          "preflight",
          `preflight-task-${sanitizePathToken(task.id)}-${Date.now()}.json`
        )
      : undefined;
    const report: TaskPreflightReport = {
      generatedAt: new Date().toISOString(),
      mode: "task",
      status: derived.status,
      includeDetection,
      task: toTaskSummary(task),
      validation,
      route,
      agents,
      availableAgents: derived.availableAgents,
      reasons: derived.reasons,
      recommendedActions: buildRecommendedActions(
        derived.status,
        route,
        validation,
        includeDetection,
        derived.availableAgents,
        {
          taskFilePath: options?.taskFilePath
        }
      ),
      artifactPath
    };

    if (artifactPath) {
      writeJsonFile(artifactPath, report);
    }

    return report;
  }

  public async inspectBatch(
    plan: LoadedBatchPlan,
    options?: PreflightOptions
  ): Promise<BatchPreflightReport> {
    const includeDetection = options?.includeDetection !== false;
    const validation = this.validation.buildReport(
      this.validation.validateBatchTargets(plan.planFilePath, path.dirname(plan.planFilePath))
    );
    const validationByPath = new Map(
      validation.results
        .filter((result) => result.kind === "task" && result.path)
        .map((result) => [path.resolve(result.path as string), result] as const)
    );
    const tasks: BatchPreflightTaskReport[] = [];

    for (const item of plan.tasks) {
      const validationResult =
        validationByPath.get(path.resolve(item.taskFilePath)) ??
        {
          kind: "task",
          valid: false,
          path: item.taskFilePath,
          summary: "Task file was not part of validation output."
        };

      if (!validationResult.valid) {
        tasks.push({
          label: item.label,
          taskFilePath: item.taskFilePath,
          status: "blocked",
          validation: validationResult,
          agents: [],
          availableAgents: 0,
          reasons: ["Validation reported this task file as invalid."]
        });
        continue;
      }

      const loaded = loadTaskFile(item.taskFilePath);
      const task: Task = {
        id: loaded.task.id ?? sanitizePathToken(path.basename(item.taskFilePath)),
        type: loaded.task.type,
        title: loaded.task.title,
        prompt: loaded.task.prompt ?? "",
        cwd: loaded.task.cwd ?? path.dirname(item.taskFilePath),
        metadata: loaded.task.metadata,
        preferredAgent: loaded.task.preferredAgent ?? "auto",
        fallbackAgents: loaded.task.fallbackAgents,
        timeoutMs: loaded.task.timeoutMs
      };
      const route = this.router.select(task);
      const agents = await buildAgentChecks(
        this.config,
        this.registry,
        route.orderedAgents,
        includeDetection
      );
      const itemValidation = this.validation.buildReport([validationResult]);
      const derived = deriveStatus(itemValidation, agents, includeDetection);

      tasks.push({
        label: item.label,
        taskFilePath: item.taskFilePath,
        taskId: task.id,
        taskType: task.type,
        status: derived.status,
        validation: validationResult,
        route,
        agents,
        availableAgents: derived.availableAgents,
        reasons: derived.reasons
      });
    }

    const readyTasks = tasks.filter((task) => task.status === "ready").length;
    const warningTasks = tasks.filter((task) => task.status === "warning").length;
    const blockedTasks = tasks.filter((task) => task.status === "blocked").length;
    const status: PreflightStatus =
      blockedTasks > 0 ? "blocked" : warningTasks > 0 ? "warning" : "ready";
    const reasons = [
      blockedTasks > 0 ? `${blockedTasks} task(s) are blocked.` : undefined,
      warningTasks > 0 ? `${warningTasks} task(s) have degraded routes.` : undefined,
      status === "ready" ? "All batch tasks passed preflight." : undefined
    ].filter((value): value is string => Boolean(value));
    const artifactRoot = path.resolve(options?.artifactCwd ?? path.dirname(plan.planFilePath));
    const artifactPath = this.config.artifacts.saveOutputs
      ? path.resolve(
          artifactRoot,
          this.config.artifacts.rootDir,
          "preflight",
          `preflight-batch-${sanitizePathToken(path.basename(plan.planFilePath, path.extname(plan.planFilePath)))}-${Date.now()}.json`
        )
      : undefined;
    const report: BatchPreflightReport = {
      generatedAt: new Date().toISOString(),
      mode: "batch",
      status,
      includeDetection,
      planFilePath: plan.planFilePath,
      validation,
      summary: {
        totalTasks: tasks.length,
        readyTasks,
        warningTasks,
        blockedTasks
      },
      tasks,
      reasons,
      recommendedActions: buildRecommendedActions(
        status,
        undefined,
        validation,
        includeDetection,
        tasks.reduce((count, task) => count + task.availableAgents, 0),
        {
          planFilePath: plan.planFilePath
        }
      ),
      artifactPath
    };

    if (artifactPath) {
      writeJsonFile(artifactPath, report);
    }

    return report;
  }
}
