export type UrlViewId = "dashboard" | "tasks" | "output";
export type UrlSeverityFilter = "ALL" | "PASS" | "WARN" | "FAIL" | "RUNNING";
export type UrlInspectorSection = "summary" | "events" | "tasks";

export interface UrlState {
  view: UrlViewId;
  eventId: string | null;
  sessionId: string | null;
  severity: UrlSeverityFilter;
  inspectorSection: UrlInspectorSection;
  q: string;
}

const DEFAULT_URL_STATE: UrlState = {
  view: "dashboard",
  eventId: null,
  sessionId: null,
  severity: "ALL",
  inspectorSection: "summary",
  q: "",
};

const VIEW_VALUES = new Set<UrlViewId>(["dashboard", "tasks", "output"]);
const INSPECTOR_VALUES = new Set<UrlInspectorSection>(["summary", "events", "tasks"]);

function parseInspectorSection(value: string | null): UrlInspectorSection {
  if (!value) {
    return "summary";
  }
  return INSPECTOR_VALUES.has(value as UrlInspectorSection) ? (value as UrlInspectorSection) : "summary";
}

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
  const sessionValue = params.get("session");
  const qValue = params.get("q");

  return {
    view: viewValue && VIEW_VALUES.has(viewValue as UrlViewId) ? (viewValue as UrlViewId) : DEFAULT_URL_STATE.view,
    eventId: eventValue && eventValue.trim().length > 0 ? eventValue.trim() : null,
    sessionId: sessionValue && sessionValue.trim().length > 0 ? sessionValue.trim() : null,
    severity: parseSeverity(params.get("severity")),
    inspectorSection: parseInspectorSection(params.get("panel")),
    q: qValue ?? "",
  };
}

export function toUrlSearch(state: UrlState): string {
  const params = new URLSearchParams();
  params.set("view", state.view);
  if (state.eventId) {
    params.set("event", state.eventId);
  }
  if (state.sessionId) {
    params.set("session", state.sessionId);
  }
  if (state.severity !== "ALL") {
    params.set("severity", serializeSeverity(state.severity));
  }
  if (state.inspectorSection !== "summary") {
    params.set("panel", state.inspectorSection);
  }
  const trimmedQuery = state.q.trim();
  if (trimmedQuery.length > 0) {
    params.set("q", trimmedQuery);
  }
  return params.toString();
}
