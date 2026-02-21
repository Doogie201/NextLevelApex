export type AllowedCommandId = "diagnose" | "listTasks" | "dryRunAll" | "dryRunTask";

const TASK_NAME_PATTERN = /^[A-Za-z0-9._()\- ]+$/;

export class AllowlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllowlistError";
  }
}

export interface CommandSpec {
  commandId: AllowedCommandId;
  argv: string[];
  timeoutMs: number;
}

export function isAllowedCommandId(value: string): value is AllowedCommandId {
  return value === "diagnose" || value === "listTasks" || value === "dryRunAll" || value === "dryRunTask";
}

export function validateTaskNameFormat(taskName: string): string {
  const trimmed = taskName.trim();
  if (!trimmed) {
    throw new AllowlistError("Task name is required.");
  }
  if (trimmed.startsWith("-") || trimmed.includes("  ")) {
    throw new AllowlistError("Task name format is invalid.");
  }
  if (!TASK_NAME_PATTERN.test(trimmed)) {
    throw new AllowlistError("Task name contains unsupported characters.");
  }
  return trimmed;
}

export function buildCommandSpec(commandIdRaw: string, taskName?: string): CommandSpec {
  if (!isAllowedCommandId(commandIdRaw)) {
    throw new AllowlistError("Command id is not allowlisted.");
  }

  if (commandIdRaw === "diagnose") {
    return { commandId: "diagnose", argv: ["nlx", "diagnose"], timeoutMs: 4500 };
  }

  if (commandIdRaw === "listTasks") {
    return { commandId: "listTasks", argv: ["nlx", "list-tasks"], timeoutMs: 4500 };
  }

  if (commandIdRaw === "dryRunAll") {
    return { commandId: "dryRunAll", argv: ["nlx", "--dry-run", "--no-reports"], timeoutMs: 15000 };
  }

  const normalizedTask = validateTaskNameFormat(taskName ?? "");
  return {
    commandId: "dryRunTask",
    argv: ["nlx", "--dry-run", "--no-reports", "--task", normalizedTask],
    timeoutMs: 10000,
  };
}

export function parseTaskNamesFromListTasks(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.split("|")[0]?.trim() ?? "")
    .filter((line) => line.length > 0)
    .filter((line) => line !== "Task")
    .filter((line) => !line.startsWith("-"));
}

export function ensureTaskIsDiscovered(taskName: string, discoveredTasks: string[]): void {
  if (!discoveredTasks.includes(taskName)) {
    throw new AllowlistError("Selected task is not in nlx list-tasks output.");
  }
}
