import {
  type CommandId,
  isCommandId,
  validateTaskNameInput,
} from "./commandContract";

export class AllowlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllowlistError";
  }
}

export interface CommandSpec {
  commandId: CommandId;
  argv: string[];
  timeoutMs: number;
}

export function isAllowedCommandId(value: string): value is CommandId {
  return isCommandId(value);
}

export function validateTaskNameFormat(taskName: string): string {
  try {
    return validateTaskNameInput(taskName);
  } catch (error) {
    if (error instanceof Error) {
      throw new AllowlistError(error.message);
    }
    throw new AllowlistError("Task name validation failed.");
  }
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
