import path from "node:path";

import { z } from "zod";

import { AppConfig } from "../config/schema";
import { readTextFile } from "../utils/fs";
import { ArtifactHistoryService } from "./history";

const batchRetryReportSchema = z.object({
  retryPlanPath: z.string().min(1).optional(),
  failedTasks: z.number().int().min(0).optional()
});

export interface RetryPlanResolution {
  retryPlanPath: string;
  source: "report" | "latest_failed";
  sourceReportPath?: string;
}

export function resolveRetryPlanFromBatchReport(
  reportFilePath: string,
  cwd = process.cwd()
): RetryPlanResolution {
  const resolvedReportPath = path.resolve(cwd, reportFilePath);
  const parsed = batchRetryReportSchema.parse(
    JSON.parse(readTextFile(resolvedReportPath))
  );

  if (!parsed.retryPlanPath) {
    throw new Error(
      `Batch report ${resolvedReportPath} does not contain retryPlanPath.`
    );
  }

  return {
    retryPlanPath: path.resolve(path.dirname(resolvedReportPath), parsed.retryPlanPath),
    source: "report",
    sourceReportPath: resolvedReportPath
  };
}

export function resolveLatestFailedRetryPlan(
  config: AppConfig,
  cwd: string
): RetryPlanResolution {
  const history = new ArtifactHistoryService(config).list({
    cwd,
    kind: "batch",
    limit: 50
  });
  const latestFailedEntry = history.entries.find((entry) => entry.status === "failed");

  if (!latestFailedEntry) {
    throw new Error(`No failed batch reports were found under ${history.rootDir}.`);
  }

  const resolution = resolveRetryPlanFromBatchReport(latestFailedEntry.path, cwd);
  return {
    ...resolution,
    source: "latest_failed"
  };
}
