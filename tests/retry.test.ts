import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/schema";
import {
  resolveLatestFailedRetryPlan,
  resolveRetryPlanFromBatchReport
} from "../src/core/retry";
import { ensureDir, writeJsonFile, writeTextFile } from "../src/utils/fs";

describe("retry helpers", () => {
  it("resolves retry plans from a batch report", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-retry-report-"));
    const reportPath = path.join(tempDir, "batch.json");
    const retryPlanPath = path.join(tempDir, "retry.yaml");

    writeTextFile(retryPlanPath, "tasks: []\n");
    writeJsonFile(reportPath, {
      failedTasks: 1,
      retryPlanPath
    });

    const resolution = resolveRetryPlanFromBatchReport(reportPath);

    expect(resolution.retryPlanPath).toBe(retryPlanPath);
    expect(resolution.source).toBe("report");
    expect(resolution.sourceReportPath).toBe(reportPath);
  });

  it("resolves the latest failed batch retry plan from artifact history", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-retry-latest-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const batchesDir = path.join(tempDir, config.artifacts.rootDir, "batches");
    const retryPlanPath = path.join(batchesDir, "retry-latest.yaml");

    ensureDir(batchesDir);
    writeTextFile(retryPlanPath, "tasks: []\n");
    writeJsonFile(path.join(batchesDir, "batch-success.json"), {
      generatedAt: "2026-04-23T00:00:01.000Z",
      failedTasks: 0
    });
    writeJsonFile(path.join(batchesDir, "batch-failed.json"), {
      generatedAt: "2026-04-23T00:00:02.000Z",
      failedTasks: 1,
      retryPlanPath
    });

    const resolution = resolveLatestFailedRetryPlan(config, tempDir);

    expect(resolution.source).toBe("latest_failed");
    expect(resolution.retryPlanPath).toBe(retryPlanPath);
    expect(resolution.sourceReportPath).toContain("batch-failed.json");
  });

  it("throws when the batch report has no retry plan", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-retry-missing-"));
    const reportPath = path.join(tempDir, "batch.json");

    writeJsonFile(reportPath, {
      failedTasks: 1
    });

    expect(() => resolveRetryPlanFromBatchReport(reportPath)).toThrow("retryPlanPath");
  });
});
