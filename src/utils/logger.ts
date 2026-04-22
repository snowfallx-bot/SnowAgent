import fs from "node:fs";
import path from "node:path";

import { LogLevel } from "../config/schema";
import { ensureDir, writeTextFile } from "./fs";

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

export interface LoggerOptions {
  level: LogLevel;
  filePath?: string;
  bindings?: Record<string, unknown>;
  initializeFile?: boolean;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export class Logger {
  private readonly level: LogLevel;
  private readonly filePath?: string;
  private readonly bindings: Record<string, unknown>;

  public constructor(options: LoggerOptions) {
    this.level = options.level;
    this.filePath = options.filePath;
    this.bindings = options.bindings ?? {};

    if (this.filePath && options.initializeFile !== false) {
      ensureDir(path.dirname(this.filePath));
      writeTextFile(this.filePath, "");
    }
  }

  public child(bindings: Record<string, unknown>): Logger {
    return new Logger({
      level: this.level,
      filePath: this.filePath,
      bindings: { ...this.bindings, ...bindings },
      initializeFile: false
    });
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    this.write("debug", message, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.write("info", message, context);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.write("warn", message, context);
  }

  public error(message: string, context?: Record<string, unknown>): void {
    this.write("error", message, context);
  }

  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
      return;
    }

    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.bindings, ...(context ?? {}) }
    };

    const line = `${record.timestamp} [${level.toUpperCase()}] ${message}${
      record.context && Object.keys(record.context).length > 0
        ? ` ${JSON.stringify(record.context)}`
        : ""
    }`;

    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }

    if (this.filePath) {
      const payload = `${JSON.stringify(record)}\n`;
      fs.appendFileSync(this.filePath, payload, "utf8");
    }
  }
}

