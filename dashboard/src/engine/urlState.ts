export type UrlViewId = "dashboard" | "tasks" | "output";
export type UrlSeverityFilter = "ALL" | "PASS" | "WARN" | "FAIL" | "RUNNING";

export interface UrlState {
  view: UrlViewId;
  eventId: string | null;
  severity: UrlSeverityFilter;
  q: string;
}

const DEFAULT_URL_STATE: UrlState = {
  view: "dashboard",
  eventId: null,
  severity: "ALL",
  q: "",
};

const VIEW_VALUES = new Set<UrlViewId>(["dashboard", "tasks", "output"]);

function parseSeverity(value: string | null): UrlSeverityFilter {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "warn") {
    return "WARN";
  }
  if (normalized === "error" || normalized === "fail") {
    return "FAIL";
  }
  if (normalized === "info" || normalized === "pass") {
    return "PASS";
  }
  if (normalized === "running") {
    return "RUNNING";
  }
  return "ALL";
}

function serializeSeverity(value: UrlSeverityFilter): string {
  if (value === "PASS") {
    return "info";
  }
  if (value === "WARN") {
    return "warn";
  }
  if (value === "FAIL") {
    return "error";
  }
  if (value === "RUNNING") {
    return "running";
  }
  return "all";
}

export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const viewValue = params.get("view");
  const eventValue = params.get("event");
  const qValue = params.get("q");

  return {
    view: viewValue && VIEW_VALUES.has(viewValue as UrlViewId) ? (viewValue as UrlViewId) : DEFAULT_URL_STATE.view,
    eventId: eventValue && eventValue.trim().length > 0 ? eventValue.trim() : null,
    severity: parseSeverity(params.get("severity")),
    q: qValue ?? "",
  };
}

export function toUrlSearch(state: UrlState): string {
  const params = new URLSearchParams();
  params.set("view", state.view);
  if (state.eventId) {
    params.set("event", state.eventId);
  }
  if (state.severity !== "ALL") {
    params.set("severity", serializeSeverity(state.severity));
  }
  const trimmedQuery = state.q.trim();
  if (trimmedQuery.length > 0) {
    params.set("q", trimmedQuery);
  }
  return params.toString();
}
