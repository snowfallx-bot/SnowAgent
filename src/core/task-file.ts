import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";
import { z } from "zod";

import { AGENT_NAMES, AgentName, TASK_TYPES, Task } from "./task";

const agentNameSchema = z.enum(AGENT_NAMES);
const taskTypeSchema = z.enum(TASK_TYPES);
const preferredAgentSchema = z.union([z.literal("auto"), agentNameSchema]);

const taskFileSchema = z.object({
  id: z.string().min(1).optional(),
  type: taskTypeSchema,
  title: z.string().optional(),
  prompt: z.string().optional(),
  promptFile: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  preferredAgent: preferredAgentSchema.optional(),
  fallbackAgents: z.array(agentNameSchema).optional(),
  timeoutMs: z.number().int().positive().optional()
}).superRefine((value, context) => {
  if (value.prompt !== undefined && value.promptFile !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Task files must use either prompt or promptFile, not both."
    });
  }
});

export interface TaskSeed {
  id?: string;
  type: Task["type"];
  title?: string;
  prompt?: string;
  cwd?: string;
  metadata?: Record<string, unknown>;
  preferredAgent?: AgentName | "auto";
  fallbackAgents?: AgentName[];
  timeoutMs?: number;
}

export interface LoadedTaskFile {
  taskFilePath: string;
  task: TaskSeed;
}

function parseTaskDocument(taskFilePath: string): unknown {
  const raw = fs.readFileSync(taskFilePath, "utf8");
  const extension = path.extname(taskFilePath).toLowerCase();

  if (extension === ".yaml" || extension === ".yml") {
    return YAML.parse(raw);
  }

  return JSON.parse(raw);
}

export function loadTaskFile(taskFilePath: string, cwd = process.cwd()): LoadedTaskFile {
  const resolvedTaskFilePath = path.resolve(cwd, taskFilePath);
  const parsed = taskFileSchema.parse(parseTaskDocument(resolvedTaskFilePath));
  const taskFileDir = path.dirname(resolvedTaskFilePath);
  const prompt = parsed.promptFile
    ? fs.readFileSync(path.resolve(taskFileDir, parsed.promptFile), "utf8")
    : parsed.prompt;

  return {
    taskFilePath: resolvedTaskFilePath,
    task: {
      id: parsed.id,
      type: parsed.type,
      title: parsed.title,
      prompt,
      cwd: parsed.cwd ? path.resolve(taskFileDir, parsed.cwd) : undefined,
      metadata: parsed.metadata,
      preferredAgent: parsed.preferredAgent,
      fallbackAgents: parsed.fallbackAgents,
      timeoutMs: parsed.timeoutMs
    }
  };
}
