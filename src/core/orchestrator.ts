import path from "node:path";
import { randomUUID } from "node:crypto";

import { AgentRunResult } from "../agents/base";
import { AgentRegistry } from "../agents/registry";
import { AppConfig } from "../config/schema";
import { writeJsonFile, writeTextFile } from "../utils/fs";
import { Logger } from "../utils/logger";
import { PromptBuilder } from "./prompt-builder";
import { Router } from "./router";
import { AgentName, RouteDecision, Task } from "./task";

export interface OrchestrationAttempt {
  agentName: AgentName;
  success: boolean;
  reason: string;
  result?: AgentRunResult;
}

export interface OrchestrationResult {
  taskId: string;
  success: boolean;
  selectedAgent?: AgentName;
  route: RouteDecision;
  attempts: OrchestrationAttempt[];
  prompt: string;
  artifactDir: string;
  startedAt: string;
  completedAt: string;
}

function sanitizePathToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "-");
}

export class Orchestrator {
  public constructor(
    private readonly config: AppConfig,
    private readonly registry: AgentRegistry,
    private readonly router: Router,
    private readonly promptBuilder: PromptBuilder,
    private readonly logger: Logger
  ) {}

  public async run(task: Task, options?: { dryRun?: boolean }): Promise<OrchestrationResult> {
    const startedAt = new Date().toISOString();
    const taskId = task.id || randomUUID();
    const prompt = this.promptBuilder.build(task);
    const route = this.router.select(task);
    const artifactDir = path.resolve(
      task.cwd,
      this.config.artifacts.rootDir,
      `${sanitizePathToken(taskId)}-${Date.now()}`
    );
    const attempts: OrchestrationAttempt[] = [];

    this.logger.info("Starting orchestration run.", {
      taskId,
      taskType: task.type,
      orderedAgents: route.orderedAgents
    });

    if (this.config.artifacts.savePromptFiles) {
      writeTextFile(path.join(artifactDir, "task-prompt.txt"), prompt);
    }

    for (const agentName of route.orderedAgents) {
      const adapter = this.registry.get(agentName);
      if (!adapter) {
        attempts.push({
          agentName,
          success: false,
          reason: "Agent is disabled or not registered."
        });
        continue;
      }

      const result = await adapter.run({
        task,
        cwd: task.cwd,
        prompt,
        timeoutMs: task.timeoutMs ?? this.config.agents[agentName].timeoutMs,
        artifactDir:
          this.config.artifacts.savePromptFiles
            ? path.join(artifactDir, agentName)
            : undefined,
        dryRun: options?.dryRun
      });

      attempts.push({
        agentName,
        success: result.success,
        reason: result.success ? "Agent completed successfully." : "Agent execution failed.",
        result
      });

      if (this.config.artifacts.saveOutputs) {
        writeJsonFile(
          path.join(artifactDir, `${agentName}-result.json`),
          result
        );
      }

      if (result.success) {
        const completedAt = new Date().toISOString();
        const orchestrationResult: OrchestrationResult = {
          taskId,
          success: true,
          selectedAgent: agentName,
          route,
          attempts,
          prompt,
          artifactDir,
          startedAt,
          completedAt
        };

        if (this.config.artifacts.saveOutputs) {
          writeJsonFile(path.join(artifactDir, "orchestration-result.json"), orchestrationResult);
        }

        return orchestrationResult;
      }
    }

    const completedAt = new Date().toISOString();
    const failedResult: OrchestrationResult = {
      taskId,
      success: false,
      route,
      attempts,
      prompt,
      artifactDir,
      startedAt,
      completedAt
    };

    if (this.config.artifacts.saveOutputs) {
      writeJsonFile(path.join(artifactDir, "orchestration-result.json"), failedResult);
    }

    return failedResult;
  }
}

