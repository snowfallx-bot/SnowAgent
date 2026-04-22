import { spawn } from "node:child_process";

export interface ProcessRunInput {
  command: string;
  args: string[];
  displayCommand: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdinData?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ProcessRunResult {
  command: string;
  args: string[];
  displayCommand: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
}

async function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/s", "/c", `taskkill /pid ${pid} /t /f`],
        {
          stdio: "ignore",
          windowsHide: true
        }
      );
      killer.on("error", () => resolve());
      killer.on("close", () => resolve());
    });
    return;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Ignore best-effort kill failures.
  }
}

export class ProcessRunner {
  public async run(input: ProcessRunInput): Promise<ProcessRunResult> {
    const startedAt = Date.now();

    return await new Promise<ProcessRunResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let exitCode: number | null = null;
      let timedOut = false;
      let settled = false;
      let timeoutHandle: NodeJS.Timeout | undefined;

      const finish = (code: number | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        exitCode = code;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        resolve({
          command: input.command,
          args: input.args,
          displayCommand: input.displayCommand,
          stdout,
          stderr,
          exitCode,
          durationMs: Date.now() - startedAt,
          timedOut
        });
      };

      try {
        const child = spawn(input.command, input.args, {
          cwd: input.cwd,
          env: input.env,
          shell: false,
          stdio: "pipe",
          windowsHide: true
        });

        child.stdout?.on("data", (chunk: Buffer | string) => {
          stdout += chunk.toString();
        });

        child.stderr?.on("data", (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });

        child.on("error", (error: Error) => {
          stderr += `${error.message}\n`;
          finish(null);
        });

        child.on("close", (code: number | null) => {
          finish(code);
        });

        if (input.stdinData !== undefined) {
          child.stdin?.on("error", () => {
            // Some CLIs close stdin immediately; this is not fatal by itself.
          });
          child.stdin?.end(input.stdinData, "utf8");
        } else {
          child.stdin?.end();
        }

        timeoutHandle = setTimeout(() => {
          timedOut = true;
          void killProcessTree(child.pid).then(() => {
            if (!settled) {
              finish(exitCode);
            }
          });
        }, input.timeoutMs);

        if (input.signal) {
          const abortHandler = (): void => {
            timedOut = true;
            void killProcessTree(child.pid).then(() => {
              if (!settled) {
                finish(exitCode);
              }
            });
          };
          input.signal.addEventListener("abort", abortHandler, { once: true });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr += `${message}\n`;
        finish(null);
      }
    });
  }
}

