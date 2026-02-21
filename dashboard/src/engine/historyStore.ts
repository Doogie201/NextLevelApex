import { redactOutput } from "./redaction";
import type { CommandEvent } from "./viewModel";

export const COMMAND_HISTORY_STORAGE_KEY = "nlx.gui.commandHistory.v1";
const MAX_STORED_ENTRIES = 30;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function sanitizeEvent(event: CommandEvent): CommandEvent {
  return {
    ...event,
    label: redactOutput(event.label),
    note: redactOutput(event.note),
    stdout: redactOutput(event.stdout),
    stderr: redactOutput(event.stderr),
    taskResults: event.taskResults.map((result) => ({
      ...result,
      reason: redactOutput(result.reason),
    })),
  };
}

export function sanitizeHistory(events: CommandEvent[]): CommandEvent[] {
  return events.map((event) => sanitizeEvent(event));
}

export function storeCommandHistory(storage: StorageLike, events: CommandEvent[]): void {
  const payload = sanitizeHistory(events)
    .filter((event) => event.outcome !== "RUNNING")
    .slice(0, MAX_STORED_ENTRIES);
  storage.setItem(COMMAND_HISTORY_STORAGE_KEY, JSON.stringify(payload));
}

function isTaskResult(value: unknown): value is CommandEvent["taskResults"][number] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const raw = value as Record<string, unknown>;
  return (
    typeof raw.taskName === "string" &&
    typeof raw.status === "string" &&
    typeof raw.reason === "string"
  );
}

function isCommandEvent(value: unknown): value is CommandEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const raw = value as Record<string, unknown>;
  return (
    typeof raw.id === "string" &&
    typeof raw.commandId === "string" &&
    typeof raw.label === "string" &&
    typeof raw.startedAt === "string" &&
    typeof raw.outcome === "string" &&
    typeof raw.note === "string" &&
    typeof raw.stdout === "string" &&
    typeof raw.stderr === "string" &&
    Array.isArray(raw.taskResults) &&
    raw.taskResults.every((item) => isTaskResult(item))
  );
}

export function loadCommandHistory(storage: StorageLike): CommandEvent[] {
  const raw = storage.getItem(COMMAND_HISTORY_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return sanitizeHistory(parsed.filter((item) => isCommandEvent(item)).slice(0, MAX_STORED_ENTRIES));
  } catch {
    return [];
  }
}
