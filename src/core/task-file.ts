import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";
import { z } from "zod";

import { writeTextFile } from "../utils/fs";
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

export type TaskFileFormat = "yaml" | "json";

export interface TaskFileDocument {
  id?: string;
  type: Task["type"];
  title?: string;
  prompt: string;
  cwd: string;
  metadata?: Record<string, unknown>;
  preferredAgent?: AgentName | "auto";
  fallbackAgents?: AgentName[];
  timeoutMs?: number;
}

export interface WriteTaskFileOptions {
  cwd?: string;
  format?: TaskFileFormat;
  stripId?: boolean;
}

export interface WrittenTaskFile {
  outputPath: string;
  format: TaskFileFormat;
  content: string;
  taskFile: TaskFileDocument;
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

function normalizeTaskFilePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function toTaskFileCwd(task: Task, outputDir: string): string {
  const relativePath = path.relative(outputDir, task.cwd);
  if (relativePath.length === 0) {
    return ".";
  }

  return normalizeTaskFilePath(
    path.isAbsolute(relativePath) ? task.cwd : relativePath
  );
}

function resolveTaskFileFormat(
  outputPath: string,
  format?: TaskFileFormat
): TaskFileFormat {
  if (format) {
    return format;
  }

  return path.extname(outputPath).toLowerCase() === ".json" ? "json" : "yaml";
}

export function createTaskFileDocument(
  task: Task,
  options?: { outputDir?: string; stripId?: boolean }
): TaskFileDocument {
  const taskFile: TaskFileDocument = {
    type: task.type,
    prompt: task.prompt,
    cwd: toTaskFileCwd(task, options?.outputDir ?? task.cwd)
  };

  if (!options?.stripId) {
    taskFile.id = task.id;
  }

  if (task.title) {
    taskFile.title = task.title;
  }

  if (task.metadata && Object.keys(task.metadata).length > 0) {
    taskFile.metadata = task.metadata;
  }

  if (task.preferredAgent) {
    taskFile.preferredAgent = task.preferredAgent;
  }

  if (task.fallbackAgents && task.fallbackAgents.length > 0) {
    taskFile.fallbackAgents = [...task.fallbackAgents];
  }

  if (task.timeoutMs !== undefined) {
    taskFile.timeoutMs = task.timeoutMs;
  }

  return taskFile;
}

export function serializeTaskFile(
  task: Task,
  options?: { outputDir?: string; format?: TaskFileFormat; stripId?: boolean }
): { format: TaskFileFormat; content: string; taskFile: TaskFileDocument } {
  const format = options?.format ?? "yaml";
  const taskFile = createTaskFileDocument(task, {
    outputDir: options?.outputDir,
    stripId: options?.stripId
  });
  const content =
    format === "json"
      ? `${JSON.stringify(taskFile, null, 2)}\n`
      : YAML.stringify(taskFile);

  return {
    format,
    content,
    taskFile
  };
}

export function writeTaskFile(
  outputPath: string,
  task: Task,
  options?: WriteTaskFileOptions
): WrittenTaskFile {
  const resolvedOutputPath = path.resolve(options?.cwd ?? process.cwd(), outputPath);
  const format = resolveTaskFileFormat(resolvedOutputPath, options?.format);
  const { content, taskFile } = serializeTaskFile(task, {
    outputDir: path.dirname(resolvedOutputPath),
    format,
    stripId: options?.stripId
  });

  writeTextFile(resolvedOutputPath, content);

  return {
    outputPath: resolvedOutputPath,
    format,
    content,
    taskFile
  };
}
