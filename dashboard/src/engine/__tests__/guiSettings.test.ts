import {
  buildGuiSettingsExportJson,
  buildGuiSettingsExportPayload,
  clearGuiSettings,
  GUI_SETTINGS_STORAGE_KEYS,
} from "../guiSettings";

describe("guiSettings helpers", () => {
  it("clears expected gui setting keys", () => {
    const removed: string[] = [];
    clearGuiSettings({
      removeItem: (key: string) => removed.push(key),
    });

    expect(removed).toEqual([...GUI_SETTINGS_STORAGE_KEYS]);
  });

  it("builds deterministic settings payload and json", () => {
    const payload = buildGuiSettingsExportPayload({
      highContrast: true,
      reduceMotionOverride: false,
      sessionsPanelOpen: true,
      sessionFilters: {
        commandId: "ALL",
        badge: "ALL",
        degradedOnly: false,
        timeRange: "7d",
      },
    });

    expect(payload).toEqual({
      version: 1,
      settings: {
        highContrast: true,
        reduceMotionOverride: false,
        sessionsPanelOpen: true,
        sessionFilters: {
          commandId: "ALL",
          badge: "ALL",
          degradedOnly: false,
          timeRange: "7d",
        },
      },
    });

    const json = buildGuiSettingsExportJson(payload.settings);
    expect(json).toContain('"version": 1');
    expect(json).toContain('"sessionsPanelOpen": true');
    expect(json).not.toContain("stdout");
    expect(json).not.toContain("stderr");
  });
});
