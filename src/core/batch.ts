import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";
import { z } from "zod";

import { AppConfig } from "../config/schema";
import { writeJsonFile } from "../utils/fs";
import { OrchestrationResult } from "./orchestrator";
import { loadTaskFile } from "./task-file";
import { Task } from "./task";

const batchTaskItemSchema = z.union([
  z.string().min(1),
  z.object({
    path: z.string().min(1),
    label: z.string().min(1).optional()
  })
]);

const batchPlanSchema = z.object({
  continueOnError: z.boolean().optional(),
  tasks: z.array(batchTaskItemSchema).min(1)
});

export interface BatchTaskPlanItem {
  label?: string;
  taskFilePath: string;
}

export interface LoadedBatchPlan {
  planFilePath: string;
  continueOnError: boolean;
  tasks: BatchTaskPlanItem[];
}

export interface BatchTaskResult {
  taskFilePath: string;
  label?: string;
  taskId?: string;
  taskType?: Task["type"];
  success: boolean;
  selectedAgent?: string;
  artifactDir?: string;
  error?: string;
}

export interface BatchRunReport {
  generatedAt: string;
  planFilePath: string;
  continueOnError: boolean;
  dryRun: boolean;
  totalTasks: number;
  succeededTasks: number;
  failedTasks: number;
  stoppedEarly: boolean;
  artifactPath?: string;
  results: BatchTaskResult[];
}

interface BatchOrchestrator {
  run(task: Task, options?: { dryRun?: boolean }): Promise<OrchestrationResult>;
}

function parseBatchPlanDocument(planFilePath: string): unknown {
  const raw = fs.readFileSync(planFilePath, "utf8");
  const extension = path.extname(planFilePath).toLowerCase();

  if (extension === ".yaml" || extension === ".yml") {
    return YAML.parse(raw);
  }

  return JSON.parse(raw);
}

function sanitizePathToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "-");
}

export function loadBatchPlan(planFilePath: string, cwd = process.cwd()): LoadedBatchPlan {
  const resolvedPlanFilePath = path.resolve(cwd, planFilePath);
  const parsed = batchPlanSchema.parse(parseBatchPlanDocument(resolvedPlanFilePath));
  const planDir = path.dirname(resolvedPlanFilePath);

  return {
    planFilePath: resolvedPlanFilePath,
    continueOnError: parsed.continueOnError ?? true,
    tasks: parsed.tasks.map((item) => {
      if (typeof item === "string") {
        return {
          taskFilePath: path.resolve(planDir, item)
        };
      }

      return {
        label: item.label,
        taskFilePath: path.resolve(planDir, item.path)
      };
    })
  };
}

export class BatchRunnerService {
  public constructor(
    private readonly config: AppConfig,
    private readonly orchestrator: BatchOrchestrator
  ) {}

  public async runPlan(
    plan: LoadedBatchPlan,
    options: { dryRun?: boolean }
  ): Promise<BatchRunReport> {
    const results: BatchTaskResult[] = [];
    let stoppedEarly = false;

    for (const item of plan.tasks) {
      try {
        const loadedTaskFile = loadTaskFile(item.taskFilePath);
        if (!loadedTaskFile.task.prompt) {
          throw new Error(
            `Task file ${item.taskFilePath} did not resolve a prompt. Add prompt or promptFile.`
          );
        }

        const task: Task = {
          id: loadedTaskFile.task.id ?? sanitizePathToken(path.basename(item.taskFilePath)),
          type: loadedTaskFile.task.type,
          title: loadedTaskFile.task.title,
          prompt: loadedTaskFile.task.prompt,
          cwd: loadedTaskFile.task.cwd ?? path.dirname(item.taskFilePath),
          metadata: loadedTaskFile.task.metadata,
          preferredAgent: loadedTaskFile.task.preferredAgent ?? "auto",
          fallbackAgents: loadedTaskFile.task.fallbackAgents,
          timeoutMs: loadedTaskFile.task.timeoutMs
        };

        const orchestrationResult = await this.orchestrator.run(task, {
          dryRun: Boolean(options.dryRun)
        });

        results.push({
          taskFilePath: item.taskFilePath,
          label: item.label,
          taskId: orchestrationResult.taskId,
          taskType: task.type,
          success: orchestrationResult.success,
          selectedAgent: orchestrationResult.selectedAgent,
          artifactDir: orchestrationResult.artifactDir
        });

        if (!orchestrationResult.success && !plan.continueOnError) {
          stoppedEarly = true;
          break;
        }
      } catch (error) {
        results.push({
          taskFilePath: item.taskFilePath,
          label: item.label,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });

        if (!plan.continueOnError) {
          stoppedEarly = true;
          break;
        }
      }
    }

    const succeededTasks = results.filter((result) => result.success).length;
    const failedTasks = results.length - succeededTasks;
    const artifactPath = this.config.artifacts.saveOutputs
      ? path.resolve(
          path.dirname(plan.planFilePath),
          this.config.artifacts.rootDir,
          "batches",
          `batch-${sanitizePathToken(path.basename(plan.planFilePath, path.extname(plan.planFilePath)))}-${Date.now()}.json`
        )
      : undefined;

    const report: BatchRunReport = {
      generatedAt: new Date().toISOString(),
      planFilePath: plan.planFilePath,
      continueOnError: plan.continueOnError,
      dryRun: Boolean(options.dryRun),
      totalTasks: plan.tasks.length,
      succeededTasks,
      failedTasks,
      stoppedEarly,
      artifactPath,
      results
    };

    if (artifactPath) {
      writeJsonFile(artifactPath, report);
    }

    return report;
  }
}
