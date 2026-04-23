import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, RETENTION_POLICY_KINDS } from "../src/config/schema";
import { RetentionService } from "../src/core/retention";
import { ensureDir, readTextFile, writeTextFile } from "../src/utils/fs";

describe("RetentionService", () => {
  it("inspects configured policies and supports filtering to one policy kind", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-retention-inspect-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const service = new RetentionService(config);

    const fullReport = service.inspect(tempDir);
    const filteredReport = service.inspect(tempDir, "log");

    expect(fullReport.filter).toBe("all");
    expect(fullReport.policyCount).toBe(RETENTION_POLICY_KINDS.length);
    expect(fullReport.enabledPolicyCount).toBe(
      RETENTION_POLICY_KINDS.filter((kind) => config.retention[kind].enabled).length
    );
    expect(filteredReport.filter).toBe("log");
    expect(filteredReport.policyCount).toBe(1);
    expect(filteredReport.policies[0]?.kind).toBe("log");
  });

  it("aggregates dry-run retention results into a single maintenance artifact", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-retention-dry-run-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const artifactsRoot = path.join(tempDir, config.artifacts.rootDir);

    for (const kind of RETENTION_POLICY_KINDS) {
      config.retention[kind].enabled = false;
    }
    config.retention.log = {
      enabled: true,
      keepLatest: 1
    };

    ensureDir(artifactsRoot);
    writeTextFile(path.join(artifactsRoot, "session-1.log"), "one");
    writeTextFile(path.join(artifactsRoot, "session-2.log"), "two");
    fs.utimesSync(
      path.join(artifactsRoot, "session-1.log"),
      new Date("2026-04-20T00:00:00.000Z"),
      new Date("2026-04-20T00:00:00.000Z")
    );
    fs.utimesSync(
      path.join(artifactsRoot, "session-2.log"),
      new Date("2026-04-23T00:00:00.000Z"),
      new Date("2026-04-23T00:00:00.000Z")
    );

    const service = new RetentionService(config);
    const report = service.execute({
      cwd: tempDir,
      kind: "log"
    });

    const maintenanceDir = path.join(artifactsRoot, "maintenance");
    const maintenanceFiles = fs
      .readdirSync(maintenanceDir)
      .filter((fileName) => fileName.endsWith(".json"));

    expect(report.mode).toBe("retention");
    expect(report.filter).toBe("log");
    expect(report.dryRun).toBe(true);
    expect(report.executedPolicies).toBe(1);
    expect(report.skippedPolicies).toBe(0);
    expect(report.matchedUnitCount).toBe(1);
    expect(report.results[0]?.prune?.artifactPath).toBeUndefined();
    expect(report.artifactPath && fs.existsSync(report.artifactPath)).toBe(true);
    expect(maintenanceFiles).toHaveLength(1);
    expect(JSON.parse(readTextFile(path.join(maintenanceDir, maintenanceFiles[0]!)))).toMatchObject({
      mode: "retention",
      filter: "log",
      matchedUnitCount: 1
    });
    expect(fs.existsSync(path.join(artifactsRoot, "session-1.log"))).toBe(true);
  });

  it("can apply a retention policy and delete matched artifacts", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-retention-apply-"));
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const artifactsRoot = path.join(tempDir, config.artifacts.rootDir);

    for (const kind of RETENTION_POLICY_KINDS) {
      config.retention[kind].enabled = false;
    }
    config.retention.log = {
      enabled: true,
      keepLatest: 1
    };

    ensureDir(artifactsRoot);
    writeTextFile(path.join(artifactsRoot, "session-1.log"), "one");
    writeTextFile(path.join(artifactsRoot, "session-2.log"), "two");
    fs.utimesSync(
      path.join(artifactsRoot, "session-1.log"),
      new Date("2026-04-20T00:00:00.000Z"),
      new Date("2026-04-20T00:00:00.000Z")
    );
    fs.utimesSync(
      path.join(artifactsRoot, "session-2.log"),
      new Date("2026-04-23T00:00:00.000Z"),
      new Date("2026-04-23T00:00:00.000Z")
    );

    const service = new RetentionService(config);
    const report = service.execute({
      cwd: tempDir,
      kind: "log",
      apply: true
    });

    expect(report.dryRun).toBe(false);
    expect(report.matchedUnitCount).toBe(1);
    expect(fs.existsSync(path.join(artifactsRoot, "session-1.log"))).toBe(false);
    expect(fs.existsSync(path.join(artifactsRoot, "session-2.log"))).toBe(true);
  });
});
