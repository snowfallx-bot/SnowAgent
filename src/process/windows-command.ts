import path from "node:path";

export interface PreparedCommand {
  file: string;
  args: string[];
}

function quoteForDisplay(value: string): string {
  if (value.length === 0) {
    return '""';
  }

  if (/[\s"]/u.test(value)) {
    return `"${value.replace(/"/gu, '\\"')}"`;
  }

  return value;
}

function quoteForCmd(value: string): string {
  if (value.length === 0) {
    return '""';
  }

  if (/[ \t"&^|<>]/u.test(value)) {
    return `"${value.replace(/"/gu, '""')}"`;
  }

  return value;
}

export function formatCommandForDisplay(command: string, args: string[]): string {
  return [quoteForDisplay(command), ...args.map(quoteForDisplay)].join(" ");
}

export function prepareWindowsCommand(command: string, args: string[]): PreparedCommand {
  if (process.platform !== "win32") {
    return { file: command, args };
  }

  const extension = path.extname(command).toLowerCase();
  if (extension === ".cmd" || extension === ".bat") {
    return {
      file: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", quoteForCmd(command), ...args]
    };
  }

  if (extension === ".ps1") {
    return {
      file: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command, ...args]
    };
  }

  return { file: command, args };
}
