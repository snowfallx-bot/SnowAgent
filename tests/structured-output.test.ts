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

