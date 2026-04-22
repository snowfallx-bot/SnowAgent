import { describe, expect, it } from "vitest";

import { formatCommandForDisplay, redactArgsForDisplay } from "../src/process/windows-command";

describe("redactArgsForDisplay", () => {
  it("redacts prompt values passed after prompt flags", () => {
    const args = redactArgsForDisplay([
      "--prompt",
      "very secret prompt",
      "--output-format",
      "json"
    ]);

    expect(args).toEqual([
      "--prompt",
      "<redacted:18 chars>",
      "--output-format",
      "json"
    ]);
  });

  it("redacts very long positional arguments", () => {
    const args = redactArgsForDisplay(["short", "x".repeat(220)]);

    expect(args).toEqual(["short", "<redacted:220 chars>"]);
  });

  it("formats a redacted command line safely for logs", () => {
    const redacted = redactArgsForDisplay(["--prompt", "secret"]);
    const commandLine = formatCommandForDisplay("copilot.exe", redacted);

    expect(commandLine).toBe('copilot.exe --prompt "<redacted:6 chars>"');
  });
});
