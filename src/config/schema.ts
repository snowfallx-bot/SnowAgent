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

function buildCodexDefaults(): AgentConfig {
  return {
    enabled: true,
    commandCandidates: ["codex", "codex.exe", "codex.cmd"],
    defaultArgs: ["exec"],
    inputModePriority: ["stdin", "args"] satisfies InputMode[],
    timeoutMs: 120000,
    retries: 1,
    env: {},
    detect: {
      versionArgs: [["--version"], ["version"]],
      helpArgs: [["exec", "--help"], ["--help"], ["-h"]]
    },
    run: {
      stdinArgs: ["-"],
      promptFileArgs: [],
      promptArgArgs: ["{prompt}"],
      jsonModeArgs: ["--json"],
      nonInteractiveArgs: ["--skip-git-repo-check", "--full-auto"],
      cwdArgs: ["--cd", "{cwd}"]
    },
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      supportsPromptFile: false
    },
    notes: [
      "Defaults target `codex exec` because it is the documented non-interactive entrypoint on the local machine.",
      "Prompt files are disabled by default because the local help text documents stdin and prompt args, not a prompt-file flag.",
      "If your Codex setup needs different safety or sandbox flags, override run.nonInteractiveArgs."
    ]
  };
}

function buildCopilotDefaults(): AgentConfig {
  return {
    enabled: true,
    commandCandidates: ["github-copilot", "copilot", "copilot.exe", "copilot.cmd"],
    defaultArgs: [],
    inputModePriority: ["args"] satisfies InputMode[],
    timeoutMs: 120000,
    retries: 1,
    env: {},
    detect: {
      versionArgs: [["--version"]],
      helpArgs: [["--help"], ["help"]]
    },
    run: {
      stdinArgs: [],
      promptFileArgs: [],
      promptArgArgs: ["--prompt", "{prompt}"],
      jsonModeArgs: ["--output-format", "json", "--silent"],
      nonInteractiveArgs: ["--allow-all-tools", "--no-ask-user", "--stream", "off"],
      cwdArgs: ["--add-dir", "{cwd}"]
    },
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      supportsStdin: false,
      supportsPromptFile: false
    },
    notes: [
      "Defaults target `copilot --prompt` because the local help documents it as the non-interactive mode.",
      "Copilot requires `--allow-all-tools` in non-interactive mode, so the default preset includes it.",
      "If your environment prefers different permissions or stream settings, override run.nonInteractiveArgs and run.jsonModeArgs."
    ]
  };
}

function buildQwenDefaults(): AgentConfig {
  return {
    enabled: true,
    commandCandidates: ["qwen", "qwen.exe", "qwen.cmd", "opencode", "opencode.exe", "opencode.cmd"],
    defaultArgs: [],
    inputModePriority: ["args"] satisfies InputMode[],
    timeoutMs: 120000,
    retries: 1,
    env: {},
    detect: {
      versionArgs: [["--version"]],
      helpArgs: [["--help"], ["-h"]]
    },
    run: {
      stdinArgs: [],
      promptFileArgs: [],
      promptArgArgs: ["{prompt}"],
      jsonModeArgs: ["--output-format", "json"],
      nonInteractiveArgs: ["--approval-mode", "yolo"],
      cwdArgs: ["--add-dir", "{cwd}"]
    },
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      supportsStdin: false,
      supportsPromptFile: false
    },
    notes: [
      "Defaults target positional prompts because the local Qwen help documents them as the one-shot path.",
      "The local Qwen CLI requires an auth type before non-interactive execution; configure auth in settings or env before relying on this preset.",
      "If your Qwen/OpenCode variant supports a different non-interactive contract, override the run templates."
    ]
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
    codex: buildCodexDefaults(),
    copilot: buildCopilotDefaults(),
    qwen: buildQwenDefaults()
  }
};
