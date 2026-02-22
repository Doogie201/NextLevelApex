import type { RunPresetConfig } from "./presetsStore";

export type RunCenterCommandId = RunPresetConfig["commandId"] | "";

export type RunCenterDisabledReasonCode =
  | "NONE"
  | "NO_COMMAND"
  | "RUN_IN_PROGRESS"
  | "TASKS_REQUIRED";

export interface RunCenterInput {
  commandId: RunCenterCommandId;
  taskNames: string[];
  isBusy: boolean;
  toggles: {
    readOnly: boolean;
    highContrast: boolean;
    reducedMotion: boolean;
  };
}

export interface RunCenterSummary {
  commandId: RunCenterCommandId;
  dryRun: true;
  taskCount: number;
  orderedTaskNames: string[];
  toggles: {
    readOnly: boolean;
    highContrast: boolean;
    reducedMotion: boolean;
  };
}

export interface RunCenterModel {
  summary: RunCenterSummary;
  canRun: boolean;
  disabledReasonCode: RunCenterDisabledReasonCode;
  disabledReason: string;
  config: RunPresetConfig | null;
}

function normalizeTasks(taskNames: string[]): string[] {
  return Array.from(new Set(taskNames.map((task) => task.trim()).filter((task) => task.length > 0))).sort((a, b) =>
    a.localeCompare(b),
  );
}

export function buildRunCenterModel(input: RunCenterInput): RunCenterModel {
  const orderedTaskNames = normalizeTasks(input.taskNames);
  const summary: RunCenterSummary = {
    commandId: input.commandId,
    dryRun: true,
    taskCount: orderedTaskNames.length,
    orderedTaskNames,
    toggles: {
      readOnly: input.toggles.readOnly,
      highContrast: input.toggles.highContrast,
      reducedMotion: input.toggles.reducedMotion,
    },
  };

  if (input.isBusy) {
    return {
      summary,
      canRun: false,
      disabledReasonCode: "RUN_IN_PROGRESS",
      disabledReason: "A command is already running. Wait for completion or cancel first.",
      config: null,
    };
  }

  if (!input.commandId) {
    return {
      summary,
      canRun: false,
      disabledReasonCode: "NO_COMMAND",
      disabledReason: "Select a command to run.",
      config: null,
    };
  }

  if (input.commandId === "dryRunTask" && orderedTaskNames.length === 0) {
    return {
      summary,
      canRun: false,
      disabledReasonCode: "TASKS_REQUIRED",
      disabledReason: "Select at least one task for dry-run task mode.",
      config: null,
    };
  }

  return {
    summary,
    canRun: true,
    disabledReasonCode: "NONE",
    disabledReason: "",
    config: {
      commandId: input.commandId,
      taskNames: input.commandId === "dryRunTask" ? orderedTaskNames : [],
      dryRun: true,
      toggles: {
        readOnly: input.toggles.readOnly,
      },
    },
  };
}

export interface PresetNameValidationResult {
  normalized: string;
  valid: boolean;
  duplicate: boolean;
  reason: string;
}

export function validatePresetName(name: string, existingNames: string[]): PresetNameValidationResult {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return {
      normalized: "",
      valid: false,
      duplicate: false,
      reason: "Preset name is required.",
    };
  }

  const duplicate = existingNames.some((existing) => existing.trim().toLowerCase() === normalized.toLowerCase());
  return {
    normalized,
    valid: true,
    duplicate,
    reason: duplicate ? "A preset with this name already exists." : "",
  };
}
