import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/schema";
import { ArtifactHistoryService } from "../src/core/history";
import { ensureDir, writeJsonFile } from "../src/utils/fs";

describe("ArtifactHistoryService", () => {
  it("lists recent doctor, preview, and run artifacts", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-history-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const artifactsRoot = path.join(tempDir, config.artifacts.rootDir);

    ensureDir(path.join(artifactsRoot, "doctor"));
    ensureDir(path.join(artifactsRoot, "previews"));
    ensureDir(path.join(artifactsRoot, "task-1"));

    writeJsonFile(path.join(artifactsRoot, "doctor", "doctor-1.json"), {
      generatedAt: "2026-04-23T00:00:03.000Z",
      summary: {
        status: "unhealthy",
        healthyAgents: 1,
        warningAgents: 0,
        unhealthyAgents: 2
      }
    });
    writeJsonFile(path.join(artifactsRoot, "previews", "route-1.json"), {
      generatedAt: "2026-04-23T00:00:02.000Z",
      task: {
        id: "route-1",
        type: "review"
      },
      route: {
        orderedAgents: ["codex", "copilot"]
      }
    });
    writeJsonFile(path.join(artifactsRoot, "previews", "prompt-1.json"), {
      generatedAt: "2026-04-23T00:00:04.000Z",
      task: {
        id: "prompt-1",
        type: "summarize"
      },
      promptLength: 321
    });
    writeJsonFile(path.join(artifactsRoot, "task-1", "orchestration-result.json"), {
      completedAt: "2026-04-23T00:00:01.000Z",
      taskId: "run-1",
      success: true,
      selectedAgent: "copilot",
      route: {
        taskType: "summarize"
      }
    });

    const history = new ArtifactHistoryService(config);
    const report = history.list({
      cwd: tempDir,
      limit: 10,
      kind: "all"
    });

    expect(report.totalEntries).toBe(4);
    expect(report.entries[0]?.kind).toBe("prompt_preview");
    expect(report.entries[1]?.kind).toBe("doctor");
    expect(report.entries[2]?.kind).toBe("route_preview");
    expect(report.entries[3]?.kind).toBe("run");
  });

  it("filters preview entries and respects the limit", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-history-filter-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const previewsDir = path.join(tempDir, config.artifacts.rootDir, "previews");

    ensureDir(previewsDir);
    writeJsonFile(path.join(previewsDir, "prompt-1.json"), {
      generatedAt: "2026-04-23T00:00:01.000Z",
      task: { id: "prompt-1", type: "summarize" },
      promptLength: 123
    });
    writeJsonFile(path.join(previewsDir, "route-1.json"), {
      generatedAt: "2026-04-23T00:00:02.000Z",
      task: { id: "route-1", type: "review" },
      route: { orderedAgents: ["codex"] }
    });

    const history = new ArtifactHistoryService(config);
    const report = history.list({
      cwd: tempDir,
      limit: 1,
      kind: "preview"
    });

    expect(report.totalEntries).toBe(2);
    expect(report.returnedEntries).toBe(1);
    expect(report.entries[0]?.kind).toBe("route_preview");
  });
});
