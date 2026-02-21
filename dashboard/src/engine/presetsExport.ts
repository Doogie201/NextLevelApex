import {
  addOrUpdatePreset,
  MAX_PRESETS,
  type RunPreset,
  type RunPresetEnvelope,
} from "./presetsStore";

export interface PresetImportResult {
  presets: RunPreset[];
  added: number;
  updated: number;
  skipped: number;
}

function sortForExport(presets: RunPreset[]): RunPreset[] {
  return [...presets].sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return byName;
    }
    return left.id.localeCompare(right.id);
  });
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isPresetEnvelope(value: unknown): value is RunPresetEnvelope {
  if (!isObjectRecord(value)) {
    return false;
  }
  if (typeof value.schemaVersion !== "number" || !Array.isArray(value.presets)) {
    return false;
  }
  return true;
}

export function buildPresetsExportJson(schemaVersion: number, presets: RunPreset[]): string {
  const payload: RunPresetEnvelope = {
    schemaVersion,
    presets: sortForExport(presets).slice(0, MAX_PRESETS),
  };
  return JSON.stringify(payload, null, 2);
}

export function parsePresetsImportJson(raw: string): RunPreset[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!isPresetEnvelope(parsed)) {
    throw new Error("Invalid presets import payload.");
  }
  if (parsed.presets.length === 0) {
    return [];
  }
  return parsed.presets as RunPreset[];
}

export function mergeImportedPresets(
  existing: RunPreset[],
  imported: RunPreset[],
  overwriteExisting: boolean,
): PresetImportResult {
  let result = [...existing];
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const preset of imported) {
    const exists = result.some((item) => item.id === preset.id);
    if (exists && !overwriteExisting) {
      skipped += 1;
      continue;
    }
    result = addOrUpdatePreset(result, preset);
    if (exists) {
      updated += 1;
    } else {
      added += 1;
    }
  }

  return {
    presets: result.slice(0, MAX_PRESETS),
    added,
    updated,
    skipped,
  };
}
