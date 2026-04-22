import { describe, expect, it } from "vitest";

import { parseStructuredOutput } from "../src/parsers/structured-output";

describe("parseStructuredOutput", () => {
  it("extracts JSON wrapped by RESULT_JSON markers", () => {
    const result = parseStructuredOutput(`
before
===RESULT_JSON===
{"summary":"ok","confidence":0.9}
===END_RESULT_JSON===
after
`);

    expect(result.format).toBe("result_json");
    expect(result.data).toEqual({
      summary: "ok",
      confidence: 0.9
    });
  });

  it("falls back to JSON code blocks", () => {
    const result = parseStructuredOutput(`
\`\`\`json
{"summary":"from markdown","next_action":"ship it"}
\`\`\`
`);

    expect(result.format).toBe("markdown_json");
    expect(result.data).toEqual({
      summary: "from markdown",
      next_action: "ship it"
    });
  });

  it("parses raw JSON objects and arrays", () => {
    const objectResult = parseStructuredOutput(`{"summary":"direct"}`);
    const arrayResult = parseStructuredOutput(`[{"type":"result","ok":true}]`);

    expect(objectResult.format).toBe("json");
    expect(objectResult.data).toEqual({ summary: "direct" });
    expect(arrayResult.format).toBe("json");
    expect(arrayResult.data).toEqual([{ type: "result", ok: true }]);
  });

  it("summarizes JSONL event streams", () => {
    const result = parseStructuredOutput(`
{"type":"assistant.message_delta","data":{"content":"{\""}}
{"type":"assistant.message","data":{"content":"{\\"ok\\":true}"}}
{"type":"result","exitCode":0}
`);

    expect(result.format).toBe("jsonl");
    expect(result.data).toEqual({
      eventCount: 2,
      eventTypes: ["assistant.message", "result"],
      messages: ['{"ok":true}'],
      finalMessage: '{"ok":true}',
      result: {
        type: "result",
        exitCode: 0
      }
    });
  });

  it("extracts heuristic fields and patches when JSON is unavailable", () => {
    const result = parseStructuredOutput(`
summary: Cache invalidation bug
next_action: Add a fallback route
confidence: 0.55

\`\`\`diff
+ retryWithFallback();
\`\`\`
`);

    expect(result.format).toBe("heuristic");
    expect(result.data).toEqual({
      summary: "Cache invalidation bug",
      next_action: "Add a fallback route",
      confidence: "0.55",
      patch: "+ retryWithFallback();"
    });
  });
});
