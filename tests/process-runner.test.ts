import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProcessRunner } from "../src/process/process-runner";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

class MockReadable extends EventEmitter {}

class MockWritable extends EventEmitter {
  public end = vi.fn();
}

class MockChildProcess extends EventEmitter {
  public readonly stdout = new MockReadable();
  public readonly stderr = new MockReadable();
  public readonly stdin = new MockWritable();
  public readonly pid = 4242;
}

describe("ProcessRunner", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("collects stdout and stderr from a child process", async () => {
    const child = new MockChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner();

    const promise = runner.run({
      command: "agent.exe",
      args: ["--help"],
      displayCommand: "agent.exe --help",
      cwd: process.cwd(),
      timeoutMs: 1000,
      stdinData: "hello"
    });

    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from("stdout line"));
      child.stderr.emit("data", Buffer.from("stderr line"));
      child.emit("close", 0);
    });

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("stdout line");
    expect(result.stderr).toBe("stderr line");
    expect(child.stdin.end).toHaveBeenCalledWith("hello", "utf8");
  });

  it("returns a structured failure when spawn throws synchronously", async () => {
    spawnMock.mockImplementation(() => {
      throw new Error("spawn failed");
    });
    const runner = new ProcessRunner();

    const result = await runner.run({
      command: "agent.exe",
      args: [],
      displayCommand: "agent.exe",
      cwd: process.cwd(),
      timeoutMs: 1000
    });

    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain("spawn failed");
  });
});
