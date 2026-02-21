import {
  buildRunPreset,
  PRESETS_SCHEMA_VERSION,
  type RunPreset,
} from "../presetsStore";
import {
  buildPresetsExportJson,
  mergeImportedPresets,
  parsePresetsImportJson,
} from "../presetsExport";

function presetFactory(id: string, name: string, commandId: "diagnose" | "dryRunAll" | "dryRunTask" = "diagnose"): RunPreset {
  return buildRunPreset({
    id,
    name,
    timestampIso: "2026-02-21T23:55:00.000Z",
    config: {
      commandId,
      taskNames: commandId === "dryRunTask" ? ["Security"] : [],
      dryRun: true,
      toggles: { readOnly: true },
    },
  });
}

describe("presetsExport", () => {
  it("exports deterministic json ordering", () => {
    const alpha = presetFactory("preset-a", "Alpha");
    const zeta = presetFactory("preset-z", "Zeta");
    const json = buildPresetsExportJson(PRESETS_SCHEMA_VERSION, [zeta, alpha]);
    const parsed = JSON.parse(json) as { schemaVersion: number; presets: Array<{ id: string }> };

    expect(parsed.schemaVersion).toBe(PRESETS_SCHEMA_VERSION);
    expect(parsed.presets.map((item) => item.id)).toEqual(["preset-a", "preset-z"]);
  });

  it("parses valid payload and rejects invalid payload", () => {
    const json = buildPresetsExportJson(PRESETS_SCHEMA_VERSION, [presetFactory("preset-a", "Alpha")]);
    const imported = parsePresetsImportJson(json);
    expect(imported).toHaveLength(1);

    expect(() => parsePresetsImportJson("{\"invalid\":true}")).toThrow("Invalid presets import payload.");
  });

  it("merges imports with or without overwrite", () => {
    const existing = [presetFactory("preset-a", "Alpha")];
    const imported = [presetFactory("preset-a", "Alpha updated", "dryRunAll"), presetFactory("preset-b", "Beta")];

    const noOverwrite = mergeImportedPresets(existing, imported, false);
    expect(noOverwrite.added).toBe(1);
    expect(noOverwrite.updated).toBe(0);
    expect(noOverwrite.skipped).toBe(1);
    expect(noOverwrite.presets.some((preset) => preset.id === "preset-a" && preset.name === "Alpha")).toBe(true);

    const overwrite = mergeImportedPresets(existing, imported, true);
    expect(overwrite.added).toBe(1);
    expect(overwrite.updated).toBe(1);
    expect(overwrite.skipped).toBe(0);
    expect(overwrite.presets.some((preset) => preset.id === "preset-a" && preset.name === "Alpha updated")).toBe(true);
  });
});
