export const COMMAND_IDS = ["diagnose", "listTasks", "dryRunAll", "dryRunTask"] as const;

export type CommandId = (typeof COMMAND_IDS)[number];

const TASK_NAME_INPUT_PATTERN = /^[A-Za-z0-9._()\- ]+$/;

export class CommandContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandContractError";
  }
}

export interface RunCommandRequest {
  commandId: CommandId;
  taskName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function isCommandId(value: string): value is CommandId {
  return (COMMAND_IDS as readonly string[]).includes(value);
}

export function validateTaskNameInput(taskNameRaw: string): string {
  const taskName = taskNameRaw.trim();
  if (!taskName) {
    throw new CommandContractError("taskName is required for dryRunTask.");
  }
  if (taskName.startsWith("-") || taskName.includes("  ")) {
    throw new CommandContractError("taskName format is invalid.");
  }
  if (!TASK_NAME_INPUT_PATTERN.test(taskName)) {
    throw new CommandContractError("taskName contains unsupported characters.");
  }
  return taskName;
}

export function parseRunCommandRequest(input: unknown): RunCommandRequest {
  if (!isRecord(input)) {
    throw new CommandContractError("Request body must be an object.");
  }

  const commandIdRaw = input.commandId;
  if (typeof commandIdRaw !== "string" || !isCommandId(commandIdRaw)) {
    throw new CommandContractError("commandId is required and must be allowlisted.");
  }

  const taskNameRaw = input.taskName;
  if (taskNameRaw !== undefined && typeof taskNameRaw !== "string") {
    throw new CommandContractError("taskName must be a string when provided.");
  }

  if (commandIdRaw === "dryRunTask") {
    return {
      commandId: commandIdRaw,
      taskName: validateTaskNameInput(taskNameRaw ?? ""),
    };
  }

  if (taskNameRaw !== undefined && taskNameRaw.trim().length > 0) {
    throw new CommandContractError("taskName is only valid with dryRunTask.");
  }

  return {
    commandId: commandIdRaw,
  };
}
