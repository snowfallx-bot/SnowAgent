import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Logger } from "../src/utils/logger";

describe("Logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("suppresses console output when console logging is disabled", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowagent-logger-"));
    const filePath = path.join(tempDir, "session.log");

    const logger = new Logger({
      level: "info",
      filePath,
      consoleEnabled: false
    });

    logger.info("structured-output");
    logger.warn("warning-output");
    logger.error("error-output");

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(fs.readFileSync(filePath, "utf8")).toContain("structured-output");
    expect(fs.readFileSync(filePath, "utf8")).toContain("warning-output");
    expect(fs.readFileSync(filePath, "utf8")).toContain("error-output");
  });
});
