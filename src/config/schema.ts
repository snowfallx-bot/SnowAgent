import { z } from "zod";

import type { InputMode } from "../agents/base";
import { AGENT_NAMES, TASK_TYPES } from "../core/task";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const inputModeSchema = z.enum(["stdin", "file", "args"]);
const agentNameSchema = z.enum(AGENT_NAMES);
const taskTypeSchema = z.enum(TASK_TYPES);

export const capabilitySchema = z.object({
  supportsStdin: z.boolean(),
  supportsPromptFile: z.boolean(),
  supportsArgs: z.boolean(),
  supportsJsonMode: z.boolean(),
  supportsCwd: z.boolean(),
  supportsNonInteractive: z.boolean()
});

export const agentConfigSchema = z.object({
  enabled: z.boolean(),
  commandCandidates: z.array(z.string()).min(1),
  executablePath: z.string().optional(),
  defaultArgs: z.array(z.string()),
  inputModePriority: z.array(inputModeSchema).min(1),
  timeoutMs: z.number().int().positive(),
  retries: z.number().int().min(0),
  env: z.record(z.string(), z.string()),
  detect: z.object({
    versionArgs: z.array(z.array(z.string())),
    helpArgs: z.array(z.array(z.string()))
  }),
  run: z.object({
    stdinArgs: z.array(z.string()),
    promptFileArgs: z.array(z.string()),
    promptArgArgs: z.array(z.string()),
    jsonModeArgs: z.array(z.string()),
    nonInteractiveArgs: z.array(z.string()),
    cwdArgs: z.array(z.string())
  }),
  capabilities: capabilitySchema,
  notes: z.array(z.string())
});

export const appConfigSchema = z.object({
  logging: z.object({
    level: logLevelSchema,
    saveLogsToFile: z.boolean()
  }),
  runtime: z.object({
    detectTimeoutMs: z.number().int().positive(),
    maxPromptArgLength: z.number().int().positive()
  }),
  artifacts: z.object({
    rootDir: z.string(),
    saveOutputs: z.boolean(),
    savePromptFiles: z.boolean(),
    saveLogs: z.boolean()
  }),
  routing: z.object({
    routes: z.record(taskTypeSchema, z.array(agentNameSchema).min(1))
  }),
  agents: z.object({
    codex: agentConfigSchema,
    copilot: agentConfigSchema,
    qwen: agentConfigSchema
  })
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;
export type ConfiguredInputMode = z.infer<typeof inputModeSchema>;

const DEFAULT_CAPABILITIES = {
  supportsStdin: true,
  supportsPromptFile: true,
  supportsArgs: true,
  supportsJsonMode: true,
  supportsCwd: true,
  supportsNonInteractive: true
} satisfies Record<keyof z.infer<typeof capabilitySchema>, boolean>;

const DEFAULT_DETECT = {
  versionArgs: [["--version"], ["version"]],
  helpArgs: [["--help"], ["-h"]]
};

const DEFAULT_RUN = {
  stdinArgs: [],
  promptFileArgs: [],
  promptArgArgs: [],
  jsonModeArgs: [],
  nonInteractiveArgs: [],
  cwdArgs: []
};

function buildAgentDefaults(
  commandCandidates: string[],
  notes: string[]
): AgentConfig {
  return {
    enabled: true,
    commandCandidates,
    defaultArgs: [],
    inputModePriority: ["stdin", "file", "args"] satisfies InputMode[],
    timeoutMs: 120000,
    retries: 1,
    env: {},
    detect: DEFAULT_DETECT,
    run: DEFAULT_RUN,
    capabilities: DEFAULT_CAPABILITIES,
    notes
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  logging: {
    level: "info",
    saveLogsToFile: true
  },
  runtime: {
    detectTimeoutMs: 5000,
    maxPromptArgLength: 4000
  },
  artifacts: {
    rootDir: "artifacts",
    saveOutputs: true,
    savePromptFiles: true,
    saveLogs: true
  },
  routing: {
    routes: {
      summarize: ["copilot", "qwen", "codex"],
      review: ["codex", "copilot", "qwen"],
      fix: ["codex", "qwen", "copilot"],
      plan: ["copilot", "qwen", "codex"]
    }
  },
  agents: {
    codex: buildAgentDefaults(
      ["codex", "codex.exe", "codex.cmd"],
      [
        "Defaults only guess a Codex-style CLI entrypoint.",
        "If your Codex CLI needs a subcommand or a prompt flag, configure defaultArgs and run templates explicitly."
      ]
    ),
    copilot: buildAgentDefaults(
      ["github-copilot", "copilot", "copilot.exe", "copilot.cmd"],
      [
        "Copilot CLI variants differ significantly.",
        "Update commandCandidates, defaultArgs, and input templates to match your installed CLI."
      ]
    ),
    qwen: buildAgentDefaults(
      ["qwen", "qwen.exe", "qwen.cmd", "opencode", "opencode.exe", "opencode.cmd"],
      [
        "The third adapter targets Qwen/OpenCode-style CLIs by configuration rather than hard-coded arguments.",
        "Override the command and run templates if your local tool uses different flags."
      ]
    )
  }
};
