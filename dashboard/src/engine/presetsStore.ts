import type { CommandId } from "./commandContract";

export const PRESETS_STORAGE_KEY = "nlx.gui.runPresets.v1";
export const PRESETS_SCHEMA_VERSION = 1;
export const MAX_PRESETS = 20;

const PRESET_COMMANDS = new Set<RunPresetCommandId>(["diagnose", "dryRunAll", "dryRunTask"]);

export type RunPresetCommandId = Extract<CommandId, "diagnose" | "dryRunAll" | "dryRunTask">;

export interface RunPresetConfig {
  commandId: RunPresetCommandId;
  taskNames: string[];
  dryRun: true;
  toggles: {
    readOnly: boolean;
  };
}

export interface RunPreset {
  id: string;
  name: string;
  config: RunPresetConfig;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface RunPresetEnvelope {
  schemaVersion: number;
  presets: RunPreset[];
}

export interface PresetsStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function normalizeTaskNames(taskNames: string[]): string[] {
  return Array.from(new Set(taskNames.map((task) => task.trim()).filter((task) => task.length > 0))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function normalizePresetName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "Untitled preset";
  }
  return trimmed.slice(0, 64);
}

function normalizePresetConfig(config: RunPresetConfig): RunPresetConfig {
  return {
    commandId: config.commandId,
    taskNames: config.commandId === "dryRunTask" ? normalizeTaskNames(config.taskNames) : [],
    dryRun: true,
    toggles: {
      readOnly: Boolean(config.toggles.readOnly),
    },
  };
}

function comparePresetOrder(left: RunPreset, right: RunPreset): number {
  const byName = left.name.localeCompare(right.name);
  if (byName !== 0) {
    return byName;
  }
  return left.id.localeCompare(right.id);
}

function normalizePreset(preset: RunPreset): RunPreset {
  return {
    id: preset.id.trim(),
    name: normalizePresetName(preset.name),
    config: normalizePresetConfig(preset.config),
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
    lastUsedAt: preset.lastUsedAt,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isValidPreset(raw: unknown): raw is RunPreset {
  if (!isObjectRecord(raw)) {
    return false;
  }
  if (
    typeof raw.id !== "string" ||
    typeof raw.name !== "string" ||
    typeof raw.createdAt !== "string" ||
    typeof raw.updatedAt !== "string" ||
    !(typeof raw.lastUsedAt === "string" || raw.lastUsedAt === null)
  ) {
    return false;
  }

  if (!isObjectRecord(raw.config)) {
    return false;
  }

  const config = raw.config as Record<string, unknown>;
  if (
    typeof config.commandId !== "string" ||
    !PRESET_COMMANDS.has(config.commandId as RunPresetCommandId) ||
    config.dryRun !== true ||
    !Array.isArray(config.taskNames) ||
    !config.taskNames.every((task) => typeof task === "string") ||
    !isObjectRecord(config.toggles) ||
    typeof (config.toggles as Record<string, unknown>).readOnly !== "boolean"
  ) {
    return false;
  }

  return true;
}

function normalizePresetList(presets: RunPreset[]): RunPreset[] {
  const map = new Map<string, RunPreset>();
  for (const preset of presets.map((item) => normalizePreset(item))) {
    if (preset.id.length === 0) {
      continue;
    }
    map.set(preset.id, preset);
  }
  return Array.from(map.values()).sort(comparePresetOrder).slice(0, MAX_PRESETS);
}

export function loadRunPresets(storage: PresetsStorageLike): RunPreset[] {
  const raw = storage.getItem(PRESETS_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObjectRecord(parsed)) {
      return [];
    }

    const schemaVersion = parsed.schemaVersion;
    const presets = parsed.presets;
    if (schemaVersion !== PRESETS_SCHEMA_VERSION || !Array.isArray(presets)) {
      return [];
    }

    const valid = presets.filter((preset): preset is RunPreset => isValidPreset(preset));
    return normalizePresetList(valid);
  } catch {
    return [];
  }
}

export function storeRunPresets(storage: PresetsStorageLike, presets: RunPreset[]): void {
  const normalized = normalizePresetList(presets);
  const envelope: RunPresetEnvelope = {
    schemaVersion: PRESETS_SCHEMA_VERSION,
    presets: normalized,
  };
  storage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(envelope));
}

export function createPresetId(name: string, timestampIso: string): string {
  const slug = normalizePresetName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const suffix = timestampIso.replace(/[^0-9]/g, "").slice(0, 17);
  return `${slug || "preset"}-${suffix}`;
}

export function buildRunPreset(input: {
  id: string;
  name: string;
  config: RunPresetConfig;
  timestampIso: string;
  lastUsedAt?: string | null;
}): RunPreset {
  return normalizePreset({
    id: input.id,
    name: input.name,
    config: input.config,
    createdAt: input.timestampIso,
    updatedAt: input.timestampIso,
    lastUsedAt: input.lastUsedAt ?? null,
  });
}

export function addOrUpdatePreset(existing: RunPreset[], preset: RunPreset): RunPreset[] {
  const map = new Map(existing.map((item) => [item.id, item]));
  map.set(preset.id, normalizePreset(preset));
  return normalizePresetList(Array.from(map.values()));
}

export function duplicatePreset(existing: RunPreset[], presetId: string, timestampIso: string): RunPreset[] {
  const source = existing.find((item) => item.id === presetId);
  if (!source) {
    return existing;
  }
  const duplicateName = `${source.name} copy`;
  const duplicated: RunPreset = {
    ...source,
    id: createPresetId(duplicateName, timestampIso),
    name: duplicateName,
    createdAt: timestampIso,
    updatedAt: timestampIso,
    lastUsedAt: null,
  };
  return addOrUpdatePreset(existing, duplicated);
}

export function markPresetUsed(existing: RunPreset[], presetId: string, timestampIso: string): RunPreset[] {
  return normalizePresetList(
    existing.map((preset) =>
      preset.id === presetId
        ? {
            ...preset,
            lastUsedAt: timestampIso,
            updatedAt: timestampIso,
          }
        : preset,
    ),
  );
}

export function parsePresetTaskInput(raw: string): string[] {
  return normalizeTaskNames(
    raw
      .split(",")
      .map((task) => task.trim())
      .filter((task) => task.length > 0),
  );
}
