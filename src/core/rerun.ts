import path from "node:path";

import { z } from "zod";

import { AppConfig } from "../config/schema";
import { readTextFile } from "../utils/fs";
import { ArtifactHistoryService } from "./history";
import { AGENT_NAMES, TASK_TYPES, Task } from "./task";

const agentNameSchema = z.enum(AGENT_NAMES);
const taskTypeSchema = z.enum(TASK_TYPES);
const preferredAgentSchema = z.union([z.literal("auto"), agentNameSchema]);

const taskSchema = z.object({
  id: z.string().min(1),
  type: taskTypeSchema,
  title: z.string().optional(),
  prompt: z.string(),
  cwd: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  preferredAgent: preferredAgentSchema.optional(),
  fallbackAgents: z.array(agentNameSchema).optional(),
  timeoutMs: z.number().int().positive().optional()
});

const orchestrationArtifactSchema = z.object({
  taskId: z.string().min(1),
  success: z.boolean().optional(),
  selectedAgent: agentNameSchema.optional(),
  completedAt: z.string().optional(),
  task: taskSchema.optional()
});

export interface RerunTaskResolution {
  source: "run_artifact" | "latest_run" | "latest_failed";
  sourceArtifactPath: string;
  originalSuccess?: boolean;
  originalSelectedAgent?: string;
  originalCompletedAt?: string;
  task: Task;
}

export function loadTaskFromRunArtifact(
  artifactPath: string,
  cwd = process.cwd()
): RerunTaskResolution {
  const resolvedArtifactPath = path.resolve(cwd, artifactPath);
  const parsed = orchestrationArtifactSchema.parse(
    JSON.parse(readTextFile(resolvedArtifactPath))
  );

  if (!parsed.task) {
    throw new Error(
      `Run artifact ${resolvedArtifactPath} does not include a task snapshot. Re-run a newer task artifact to enable rerun.`
    );
  }

  return {
    source: "run_artifact",
    sourceArtifactPath: resolvedArtifactPath,
    originalSuccess: parsed.success,
    originalSelectedAgent: parsed.selectedAgent,
    originalCompletedAt: parsed.completedAt,
    task: parsed.task
  };
}

export function resolveLatestRunTask(
  config: AppConfig,
  cwd: string,
  options?: { failedOnly?: boolean }
): RerunTaskResolution {
  const history = new ArtifactHistoryService(config).list({
    cwd,
    kind: "run",
    limit: 100
  });
  const entry = options?.failedOnly
    ? history.entries.find((item) => item.status === "failed")
    : history.entries[0];

  if (!entry) {
    throw new Error(
      options?.failedOnly
        ? `No failed run artifacts were found under ${history.rootDir}.`
        : `No run artifacts were found under ${history.rootDir}.`
    );
  }

  const resolution = loadTaskFromRunArtifact(entry.path, cwd);
  return {
    ...resolution,
    source: options?.failedOnly ? "latest_failed" : "latest_run"
  };
}
