import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/schema";
import { ConfigReportService } from "../src/core/config-report";

describe("ConfigReportService", () => {
  it("reports effective config details and supports agent filtering", () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    config.agents.qwen.enabled = false;

    const report = new ConfigReportService(
      config,
      "C:\\repo\\agent-orchestrator.config.yaml"
    ).inspect({
      agentNames: ["copilot"]
    });

    expect(report.usingDefaultConfig).toBe(false);
    expect(report.configPath).toBe("C:\\repo\\agent-orchestrator.config.yaml");
    expect(report.retention.preview.keepLatest).toBe(20);
    expect(report.retention.status.keepLatest).toBe(30);
    expect(report.retention.run.enabled).toBe(false);
    expect(report.routing.review).toEqual(["codex", "copilot", "qwen"]);
    expect(report.agents).toHaveLength(1);
    expect(report.agents[0]?.name).toBe("copilot");
    expect(report.agents[0]?.run.promptArgArgs).toEqual(["--prompt", "{prompt}"]);
  });
});
