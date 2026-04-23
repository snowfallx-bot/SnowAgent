import fs from "node:fs";
import path from "node:path";

import { loadBatchPlan } from "./batch";
import { loadTaskFile } from "./task-file";
import { loadConfig, resolveConfigPath } from "../config/load-config";

export const VALIDATION_KINDS = ["config", "task", "batch"] as const;
export type ValidationKind = (typeof VALIDATION_KINDS)[number];

export interface ValidationResult {
  kind: ValidationKind;
  valid: boolean;
  path?: string;
  summary: string;
  details?: string;
}

export interface ValidationReport {
  generatedAt: string;
  allValid: boolean;
  results: ValidationResult[];
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeTaskPromptLength(prompt: string | undefined): number {
  return prompt?.length ?? 0;
}

export class ValidationService {
  public validateConfig(configPath: string | undefined, cwd: string): ValidationResult {
    try {
      const resolvedPath = configPath
        ? path.resolve(cwd, configPath)
        : resolveConfigPath(undefined, cwd);

      if (configPath && !resolvedPath) {
        return {
          kind: "config",
          valid: false,
          path: path.resolve(cwd, configPath),
          summary: "Config file was not found.",
          details: `No file exists at ${path.resolve(cwd, configPath)}.`
        };
      }

      const { config, configPath: loadedConfigPath } = loadConfig(configPath, cwd);
      if (!loadedConfigPath) {
        return {
          kind: "config",
          valid: true,
          summary: "No config file found; built-in defaults are valid.",
          details: `Routing summarize=${config.routing.routes.summarize.join(" -> ")}`
        };
      }

      return {
        kind: "config",
        valid: true,
        path: loadedConfigPath,
        summary: "Config file is valid.",
        details: `Loaded ${loadedConfigPath} with logLevel=${config.logging.level}.`
      };
    } catch (error) {
      return {
        kind: "config",
        valid: false,
        path: configPath ? path.resolve(cwd, configPath) : undefined,
        summary: "Config validation failed.",
        details: formatError(error)
      };
    }
  }

  public validateTaskFile(taskFilePath: string, cwd: string): ValidationResult {
    const resolvedPath = path.resolve(cwd, taskFilePath);

    try {
      const loaded = loadTaskFile(taskFilePath, cwd);
      return {
        kind: "task",
        valid: true,
        path: loaded.taskFilePath,
        summary: `Task file is valid for type=${loaded.task.type}.`,
        details: `cwd=${loaded.task.cwd ?? path.dirname(loaded.taskFilePath)} promptLength=${summarizeTaskPromptLength(loaded.task.prompt)}`
      };
    } catch (error) {
      return {
        kind: "task",
        valid: false,
        path: resolvedPath,
        summary: "Task file validation failed.",
        details: formatError(error)
      };
    }
  }

  public validateBatchPlan(planFilePath: string, cwd: string): ValidationResult {
    const resolvedPath = path.resolve(cwd, planFilePath);

    try {
      const plan = loadBatchPlan(planFilePath, cwd);
      const missingTaskFiles = plan.tasks
        .map((item) => item.taskFilePath)
        .filter((taskPath) => !fs.existsSync(taskPath));

      if (missingTaskFiles.length > 0) {
        return {
          kind: "batch",
          valid: false,
          path: plan.planFilePath,
          summary: "Batch plan references missing task files.",
          details: missingTaskFiles.join(", ")
        };
      }

      return {
        kind: "batch",
        valid: true,
        path: plan.planFilePath,
        summary: `Batch plan is valid with ${plan.tasks.length} task(s).`,
        details: `continueOnError=${plan.continueOnError}`
      };
    } catch (error) {
      return {
        kind: "batch",
        valid: false,
        path: resolvedPath,
        summary: "Batch plan validation failed.",
        details: formatError(error)
      };
    }
  }

  public buildReport(results: ValidationResult[]): ValidationReport {
    return {
      generatedAt: new Date().toISOString(),
      allValid: results.every((result) => result.valid),
      results
    };
  }
}
