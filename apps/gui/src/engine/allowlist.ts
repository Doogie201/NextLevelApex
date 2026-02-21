import type { CommandArgs, CommandId } from "./types";

const TASK_NAME_PATTERN = /^[A-Za-z0-9._()\- ]+$/;

export function buildAllowlistedArgv(commandId: CommandId, args: CommandArgs = {}): string[] {
  if (commandId === "diagnose") {
    return ["nlx", "diagnose"];
  }

  if (commandId === "listTasks") {
    return ["nlx", "list-tasks"];
  }

  if (commandId === "dryRunAll") {
    return ["nlx", "--dry-run", "--no-reports"];
  }

  if (commandId === "dryRunTask") {
    const rawName = args.taskName ?? "";
    const trimmed = rawName.trim();
    if (!trimmed) {
      throw new Error("Task name is required for dryRunTask.");
    }
    if (trimmed.startsWith("-") || trimmed.includes("  ")) {
      throw new Error("Task name format is invalid.");
    }
    if (!TASK_NAME_PATTERN.test(trimmed)) {
      throw new Error("Task name contains unsupported characters.");
    }
    return ["nlx", "--dry-run", "--no-reports", "--task", trimmed];
  }

  const _exhaustive: never = commandId;
  throw new Error(`Disallowed command id: ${_exhaustive}`);
}
