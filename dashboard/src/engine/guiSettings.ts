import { REDUCED_MOTION_STORAGE_KEY } from "./reducedMotion";

export const GUI_SETTINGS_STORAGE_KEYS = ["nlx.gui.highContrast", REDUCED_MOTION_STORAGE_KEY] as const;

export interface GuiSettingsStorageLike {
  removeItem(key: string): void;
}

export interface GuiSettingsExportInput {
  highContrast: boolean;
  reduceMotionOverride: boolean | null;
  sessionsPanelOpen: boolean;
  sessionFilters: {
    commandId: string;
    badge: string;
    degradedOnly: boolean;
    timeRange: string;
  };
}

export interface GuiSettingsExportPayload {
  version: number;
  settings: GuiSettingsExportInput;
}

export function clearGuiSettings(storage: GuiSettingsStorageLike): void {
  for (const key of GUI_SETTINGS_STORAGE_KEYS) {
    storage.removeItem(key);
  }
}

export function buildGuiSettingsExportPayload(input: GuiSettingsExportInput): GuiSettingsExportPayload {
  return {
    version: 1,
    settings: {
      highContrast: input.highContrast,
      reduceMotionOverride: input.reduceMotionOverride,
      sessionsPanelOpen: input.sessionsPanelOpen,
      sessionFilters: {
        commandId: input.sessionFilters.commandId,
        badge: input.sessionFilters.badge,
        degradedOnly: input.sessionFilters.degradedOnly,
        timeRange: input.sessionFilters.timeRange,
      },
    },
  };
}

export function buildGuiSettingsExportJson(input: GuiSettingsExportInput): string {
  return JSON.stringify(buildGuiSettingsExportPayload(input), null, 2);
}
