import { describe, expect, it } from "vitest";

import { Router } from "../src/core/router";
import { DEFAULT_CONFIG } from "../src/config/schema";
import { Task } from "../src/core/task";

describe("Router", () => {
  it("prioritizes preferred agent and preserves fallback order", () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const router = new Router(config);
    const task: Task = {
      id: "task-1",
      type: "review",
      title: "Review a change",
      prompt: "Review this diff",
      cwd: process.cwd(),
      preferredAgent: "qwen",
      fallbackAgents: ["copilot"]
    };

    const decision = router.select(task);
    expect(decision.orderedAgents).toEqual(["qwen", "copilot", "codex"]);
    expect(decision.reasons.some((reason) => reason.includes("preferredAgent"))).toBe(true);
  });
});

