import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";

import { AppConfig, appConfigSchema, DEFAULT_CONFIG } from "./schema";

const DEFAULT_CONFIG_FILES = [
  "agent-orchestrator.config.json",
  "agent-orchestrator.config.yaml",
  "agent-orchestrator.config.yml"
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge<T>(baseValue: T, overrideValue: unknown): T {
  if (Array.isArray(baseValue)) {
    return (Array.isArray(overrideValue) ? overrideValue : baseValue) as T;
  }

  if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
    const result: Record<string, unknown> = { ...baseValue };
    for (const [key, value] of Object.entries(overrideValue)) {
      const current = result[key];
      result[key] =
        current === undefined ? value : deepMerge(current, value);
    }
    return result as T;
  }

  return (overrideValue === undefined ? baseValue : overrideValue) as T;
}

function parseConfigFile(configPath: string): unknown {
  const raw = fs.readFileSync(configPath, "utf8");
  const extension = path.extname(configPath).toLowerCase();

  if (extension === ".yaml" || extension === ".yml") {
    return YAML.parse(raw);
  }

  return JSON.parse(raw);
}

export function resolveConfigPath(explicitPath?: string, cwd = process.cwd()): string | undefined {
  if (explicitPath) {
    const resolved = path.resolve(cwd, explicitPath);
    return fs.existsSync(resolved) ? resolved : undefined;
  }

  for (const fileName of DEFAULT_CONFIG_FILES) {
    const candidate = path.resolve(cwd, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function loadConfig(explicitPath?: string, cwd = process.cwd()): {
  config: AppConfig;
  configPath?: string;
} {
  const configPath = resolveConfigPath(explicitPath, cwd);
  const merged = configPath
    ? deepMerge(DEFAULT_CONFIG, parseConfigFile(configPath))
    : DEFAULT_CONFIG;

  const config = appConfigSchema.parse(merged);
  return { config, configPath };
}

