import {
  CommandContractError,
  isCommandId,
  parseRunCommandRequest,
  validateTaskNameInput,
} from "../commandContract";

describe("command contract", () => {
  it("accepts only supported command ids", () => {
    expect(isCommandId("diagnose")).toBe(true);
    expect(isCommandId("dryRunAll")).toBe(true);
    expect(isCommandId("reset")).toBe(false);
  });

  it("parses valid requests", () => {
    expect(parseRunCommandRequest({ commandId: "diagnose" })).toEqual({ commandId: "diagnose" });

    expect(parseRunCommandRequest({ commandId: "dryRunTask", taskName: "DNS Stack Sanity Check" })).toEqual({
      commandId: "dryRunTask",
      taskName: "DNS Stack Sanity Check",
    });
  });

  it("rejects invalid command ids and payload shapes", () => {
    expect(() => parseRunCommandRequest({ commandId: "autofix" })).toThrow(CommandContractError);
    expect(() => parseRunCommandRequest({ commandId: "diagnose", taskName: "Mise" })).toThrow(
      /only valid with dryRunTask/i,
    );
    expect(() => parseRunCommandRequest({ commandId: "dryRunTask" })).toThrow(/taskName is required/i);
  });

  it("rejects unsafe task names", () => {
    expect(validateTaskNameInput("Cloudflared")).toBe("Cloudflared");
    expect(() => validateTaskNameInput("-Cloudflared")).toThrow(CommandContractError);
    expect(() => validateTaskNameInput("Cloud;flared")).toThrow(CommandContractError);
  });
});
