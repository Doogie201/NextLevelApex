import { parseUrlState, toUrlSearch } from "../urlState";

describe("urlState helpers", () => {
  it("parses valid deep-link values", () => {
    expect(parseUrlState("?view=output&event=evt-123&session=run-1&panel=events&severity=warn&q=cloudflared")).toEqual({
      view: "output",
      eventId: "evt-123",
      sessionId: "run-1",
      severity: "WARN",
      inspectorSection: "events",
      q: "cloudflared",
    });
  });

  it("maps severity aliases and defaults invalid values safely", () => {
    expect(parseUrlState("?severity=info").severity).toBe("PASS");
    expect(parseUrlState("?severity=error").severity).toBe("FAIL");
    expect(parseUrlState("?severity=unknown").severity).toBe("ALL");
    expect(parseUrlState("?view=bad&event=   ").view).toBe("dashboard");
    expect(parseUrlState("?view=bad&event=   ").eventId).toBeNull();
    expect(parseUrlState("?panel=bogus").inspectorSection).toBe("summary");
  });

  it("serializes state to canonical query params", () => {
    const search = toUrlSearch({
      view: "tasks",
      eventId: "evt-42",
      sessionId: "run-42",
      severity: "FAIL",
      inspectorSection: "tasks",
      q: "dns leak",
    });
    const params = new URLSearchParams(search);

    expect(params.get("view")).toBe("tasks");
    expect(params.get("event")).toBe("evt-42");
    expect(params.get("session")).toBe("run-42");
    expect(params.get("severity")).toBe("error");
    expect(params.get("panel")).toBe("tasks");
    expect(params.get("q")).toBe("dns leak");
  });

  it("omits default and empty values during serialization", () => {
    const search = toUrlSearch({
      view: "dashboard",
      eventId: null,
      sessionId: null,
      severity: "ALL",
      inspectorSection: "summary",
      q: "   ",
    });
    const params = new URLSearchParams(search);

    expect(params.get("view")).toBe("dashboard");
    expect(params.has("event")).toBe(false);
    expect(params.has("session")).toBe(false);
    expect(params.has("severity")).toBe(false);
    expect(params.has("panel")).toBe(false);
    expect(params.has("q")).toBe(false);
  });
});
