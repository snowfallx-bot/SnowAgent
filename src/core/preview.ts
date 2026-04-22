import path from "node:path";

import { AgentDetectionResult } from "../agents/base";
import { AgentRegistry } from "../agents/registry";
import { AppConfig } from "../config/schema";
import { writeJsonFile, writeTextFile } from "../utils/fs";
import { PromptBuilder } from "./prompt-builder";
import { Router } from "./router";
import { AgentName, RouteDecision, Task } from "./task";

export interface RoutePreviewAgent {
  agentName: AgentName;
  enabled: boolean;
  configNotes: string[];
  detection?: AgentDetectionResult;
}

export interface RoutePreviewReport {
  generatedAt: string;
  task: {
    id: string;
    type: Task["type"];
    title?: string;
    cwd: string;
    preferredAgent: Task["preferredAgent"];
    fallbackAgents: AgentName[];
  };
  includeDetection: boolean;
  route: RouteDecision;
  agents: RoutePreviewAgent[];
  artifactPath?: string;
}

export interface PromptPreviewReport {
  generatedAt: string;
  task: {
    id: string;
    type: Task["type"];
    title?: string;
    cwd: string;
    preferredAgent: Task["preferredAgent"];
    fallbackAgents: AgentName[];
  };
  route: RouteDecision;
  prompt: string;
  promptLength: number;
  artifactPath?: string;
  promptArtifactPath?: string;
}

export interface RoutePreviewOptions {
  includeDetection?: boolean;
}

function sanitizePathToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "-");
}

function toTaskSummary(task: Task): RoutePreviewReport["task"] {
  return {
    id: task.id,
    type: task.type,
    title: task.title,
    cwd: task.cwd,
    preferredAgent: task.preferredAgent ?? "auto",
    fallbackAgents: [...(task.fallbackAgents ?? [])]
  };
}

export class PreviewService {
  public constructor(
    private readonly config: AppConfig,
    private readonly registry: AgentRegistry,
    private readonly router: Router,
    private readonly promptBuilder: PromptBuilder
  ) {}

  public async inspectRoute(
    task: Task,
    options?: RoutePreviewOptions
  ): Promise<RoutePreviewReport> {
    const includeDetection = Boolean(options?.includeDetection);
    const route = this.router.select(task);
    const generatedAt = new Date().toISOString();
    const agents: RoutePreviewAgent[] = [];

    for (const agentName of route.orderedAgents) {
      const agent = this.registry.get(agentName);
      agents.push({
        agentName,
        enabled: this.config.agents[agentName].enabled,
        configNotes: [...this.config.agents[agentName].notes],
        detection: includeDetection && agent ? await agent.detect() : undefined
      });
    }

    const artifactPath = this.config.artifacts.saveOutputs
      ? path.resolve(
          task.cwd,
          this.config.artifacts.rootDir,
          "previews",
          `route-${sanitizePathToken(task.id)}-${Date.now()}.json`
        )
      : undefined;

    const report: RoutePreviewReport = {
      generatedAt,
      task: toTaskSummary(task),
      includeDetection,
      route,
      agents,
      artifactPath
    };

    if (artifactPath) {
      writeJsonFile(artifactPath, report);
    }

    return report;
  }

  public async previewPrompt(task: Task): Promise<PromptPreviewReport> {
    const route = this.router.select(task);
    const generatedAt = new Date().toISOString();
    const prompt = this.promptBuilder.build(task);
    const baseArtifactPath = path.resolve(
      task.cwd,
      this.config.artifacts.rootDir,
      "previews",
      `prompt-${sanitizePathToken(task.id)}-${Date.now()}`
    );
    const artifactPath = this.config.artifacts.saveOutputs
      ? `${baseArtifactPath}.json`
      : undefined;
    const promptArtifactPath = this.config.artifacts.savePromptFiles
      ? `${baseArtifactPath}.txt`
      : undefined;

    const report: PromptPreviewReport = {
      generatedAt,
      task: toTaskSummary(task),
      route,
      prompt,
      promptLength: prompt.length,
      artifactPath,
      promptArtifactPath
    };

    if (artifactPath) {
      writeJsonFile(artifactPath, report);
    }

    if (promptArtifactPath) {
      writeTextFile(promptArtifactPath, prompt);
    }

    return report;
  }
}
