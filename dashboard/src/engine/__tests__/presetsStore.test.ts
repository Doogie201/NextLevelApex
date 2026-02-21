import {
  addOrUpdatePreset,
  buildRunPreset,
  createPresetId,
  duplicatePreset,
  loadRunPresets,
  markPresetUsed,
  parsePresetTaskInput,
  PRESETS_SCHEMA_VERSION,
  storeRunPresets,
  type PresetsStorageLike,
  type RunPreset,
} from "../presetsStore";

function createStorage(initial: string | null = null): PresetsStorageLike & { value: string | null } {
  let current = initial;
  return {
    get value() {
      return current;
    },
    getItem: () => current,
    setItem: (_key: string, value: string) => {
      current = value;
    },
  };
}

function presetFactory(id: string, name: string): RunPreset {
  return buildRunPreset({
    id,
    name,
    timestampIso: "2026-02-21T23:30:00.000Z",
    config: {
      commandId: "diagnose",
      taskNames: [],
      dryRun: true,
      toggles: { readOnly: true },
    },
  });
}

describe("presetsStore", () => {
  it("stores and loads valid presets with schema", () => {
    const storage = createStorage();
    const preset = presetFactory("preset-1", "Baseline Diagnose");

    storeRunPresets(storage, [preset]);
    const loaded = loadRunPresets(storage);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe("preset-1");
    expect(storage.value).toContain(`"schemaVersion":${PRESETS_SCHEMA_VERSION}`);
  });

  it("drops invalid envelopes and invalid entries safely", () => {
    const invalidEnvelope = createStorage(JSON.stringify({ schemaVersion: 999, presets: [] }));
    expect(loadRunPresets(invalidEnvelope)).toEqual([]);

    const partial = createStorage(
      JSON.stringify({
        schemaVersion: PRESETS_SCHEMA_VERSION,
        presets: [{ id: "bad-only" }],
      }),
    );
    expect(loadRunPresets(partial)).toEqual([]);
  });

  it("creates deterministic ids and parses task input", () => {
    const id = createPresetId("My Security Dry Run", "2026-02-21T23:31:05.000Z");
    expect(id).toBe("my-security-dry-run-20260221233105000");
    expect(parsePresetTaskInput(" Security,Cloudflared, Security , DNS Stack Sanity Check ")).toEqual([
      "Cloudflared",
      "DNS Stack Sanity Check",
      "Security",
    ]);
  });

  it("supports add/update/duplicate/mark-used flows", () => {
    const base = presetFactory("preset-a", "A");
    const updated = {
      ...base,
      name: "A updated",
    };

    const withUpdate = addOrUpdatePreset([base], updated);
    expect(withUpdate).toHaveLength(1);
    expect(withUpdate[0]?.name).toBe("A updated");

    const withDuplicate = duplicatePreset(withUpdate, "preset-a", "2026-02-21T23:40:00.000Z");
    expect(withDuplicate).toHaveLength(2);
    expect(withDuplicate.some((item) => item.name === "A updated copy")).toBe(true);

    const marked = markPresetUsed(withDuplicate, "preset-a", "2026-02-21T23:41:00.000Z");
    expect(marked.find((item) => item.id === "preset-a")?.lastUsedAt).toBe("2026-02-21T23:41:00.000Z");
  });
});
