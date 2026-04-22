import { describe, expect, it } from "vitest";

import { ConfigurableCliAgentAdapter, AgentAdapterDeps } from "../src/agents/base";
import { DEFAULT_CONFIG } from "../src/config/schema";
import { ProcessRunner } from "../src/process/process-runner";
import { Logger } from "../src/utils/logger";

class TestAdapter extends ConfigurableCliAgentAdapter {
  public constructor() {
    const deps: AgentAdapterDeps = {
      appConfig: DEFAULT_CONFIG,
      processRunner: new ProcessRunner(),
      logger: new Logger({ level: "error" })
    };

    super("copilot", DEFAULT_CONFIG.agents.copilot, deps);
  }
}

describe("ConfigurableCliAgentAdapter.parseOutput", () => {
  it("extracts nested JSON from JSONL envelopes", () => {
    const adapter = new TestAdapter();
    const stdout = [
      JSON.stringify({
        type: "assistant.message",
        data: {
          content: "{\"summary\":\"nested\"}"
        }
      }),
      JSON.stringify({
        type: "result",
        exitCode: 0
      })
    ].join("\n");

    const parsed = adapter.parseOutput(stdout, "");

    expect(parsed?.format).toBe("json");
    expect(parsed?.data).toEqual({ summary: "nested" });
    expect(parsed?.extractionNotes.some((note) => note.includes("jsonl envelope"))).toBe(true);
  });

  it("extracts nested RESULT_JSON blocks from JSON arrays", () => {
    const adapter = new TestAdapter();
    const stdout = JSON.stringify([
      {
        type: "assistant.message",
        data: {
          content: "===RESULT_JSON===\n{\"summary\":\"array\"}\n===END_RESULT_JSON==="
        }
      }
    ]);

    const parsed = adapter.parseOutput(stdout, "");

    expect(parsed?.format).toBe("result_json");
    expect(parsed?.data).toEqual({ summary: "array" });
  });
});
