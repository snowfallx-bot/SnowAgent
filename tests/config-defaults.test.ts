import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/schema";

describe("DEFAULT_CONFIG agent presets", () => {
  it("uses codex exec as the calibrated non-interactive default", () => {
    const codex = DEFAULT_CONFIG.agents.codex;

    expect(codex.defaultArgs).toEqual(["exec"]);
    expect(codex.inputModePriority).toEqual(["stdin", "args"]);
    expect(codex.run.stdinArgs).toEqual(["-"]);
    expect(codex.run.jsonModeArgs).toEqual(["--json"]);
    expect(codex.run.cwdArgs).toEqual(["--cd", "{cwd}"]);
    expect(codex.capabilities.supportsStdin).toBe(true);
    expect(codex.capabilities.supportsPromptFile).toBe(false);
  });

  it("uses copilot prompt mode with JSON output and auto-approval flags", () => {
    const copilot = DEFAULT_CONFIG.agents.copilot;

    expect(copilot.inputModePriority).toEqual(["args"]);
    expect(copilot.run.promptArgArgs).toEqual(["--prompt", "{prompt}"]);
    expect(copilot.run.jsonModeArgs).toEqual(["--output-format", "json", "--silent"]);
    expect(copilot.run.nonInteractiveArgs).toEqual([
      "--allow-all-tools",
      "--no-ask-user",
      "--stream",
      "off"
    ]);
    expect(copilot.capabilities.supportsStdin).toBe(false);
    expect(copilot.capabilities.supportsPromptFile).toBe(false);
  });

  it("uses qwen positional prompts and keeps auth as an explicit user concern", () => {
    const qwen = DEFAULT_CONFIG.agents.qwen;

    expect(qwen.inputModePriority).toEqual(["args"]);
    expect(qwen.run.promptArgArgs).toEqual(["{prompt}"]);
    expect(qwen.run.jsonModeArgs).toEqual(["--output-format", "json"]);
    expect(qwen.run.nonInteractiveArgs).toEqual(["--approval-mode", "yolo"]);
    expect(qwen.notes.some((note) => note.includes("auth type"))).toBe(true);
    expect(qwen.capabilities.supportsStdin).toBe(false);
    expect(qwen.capabilities.supportsPromptFile).toBe(false);
  });
});
