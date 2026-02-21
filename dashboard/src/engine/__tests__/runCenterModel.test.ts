import { buildRunCenterModel, validatePresetName } from "../runCenterModel";

describe("runCenterModel", () => {
  it("returns deterministic disabled reasons", () => {
    const noCommand = buildRunCenterModel({
      commandId: "",
      taskNames: [],
      isBusy: false,
      toggles: {
        readOnly: true,
        highContrast: false,
        reducedMotion: false,
      },
    });

    const busy = buildRunCenterModel({
      commandId: "diagnose",
      taskNames: [],
      isBusy: true,
      toggles: {
        readOnly: true,
        highContrast: false,
        reducedMotion: false,
      },
    });

    expect(noCommand.disabledReasonCode).toBe("NO_COMMAND");
    expect(noCommand.disabledReason).toBe("Select a command to run.");
    expect(busy.disabledReasonCode).toBe("RUN_IN_PROGRESS");
    expect(busy.disabledReason).toBe("A command is already running. Wait for completion or cancel first.");
  });

  it("builds deterministic summary with sorted tasks", () => {
    const model = buildRunCenterModel({
      commandId: "dryRunTask",
      taskNames: ["Security", "Cloudflared", "Security", "DNS Stack Sanity Check"],
      isBusy: false,
      toggles: {
        readOnly: true,
        highContrast: true,
        reducedMotion: true,
      },
    });

    expect(model.canRun).toBe(true);
    expect(model.summary.orderedTaskNames).toEqual(["Cloudflared", "DNS Stack Sanity Check", "Security"]);
    expect(model.summary.taskCount).toBe(3);
    expect(model.summary.dryRun).toBe(true);
    expect(model.config?.commandId).toBe("dryRunTask");
  });

  it("validates preset names and duplicate behavior", () => {
    const missing = validatePresetName("   ", ["Baseline"]);
    expect(missing.valid).toBe(false);
    expect(missing.reason).toBe("Preset name is required.");

    const duplicate = validatePresetName(" baseline  ", ["Baseline", "Security run"]);
    expect(duplicate.valid).toBe(true);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.reason).toBe("A preset with this name already exists.");

    const unique = validatePresetName("Cloudflared checks", ["Baseline", "Security run"]);
    expect(unique.valid).toBe(true);
    expect(unique.duplicate).toBe(false);
    expect(unique.normalized).toBe("Cloudflared checks");
  });
});
