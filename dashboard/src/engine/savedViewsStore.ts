export const SAVED_VIEWS_STORAGE_KEY = "nlx.gui.savedViews.v1";
export const SAVED_VIEWS_SCHEMA_VERSION = 1;
export const MAX_SAVED_VIEWS = 12;
export const MAX_SAVED_VIEW_NAME_LENGTH = 64;

export interface SavedViewEntry {
  name: string;
  url: string;
}

export interface SavedViewsEnvelope {
  schemaVersion: number;
  views: SavedViewEntry[];
}

export interface SavedViewsStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AddSavedViewResult {
  views: SavedViewEntry[];
  savedName: string;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeName(raw: string): string {
  const normalized = raw.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "Untitled view";
  }
  return normalized.slice(0, MAX_SAVED_VIEW_NAME_LENGTH);
}

function normalizeUrl(raw: string): string {
  return raw.trim();
}

function normalizeEntry(entry: SavedViewEntry): SavedViewEntry | null {
  const name = normalizeName(entry.name);
  const url = normalizeUrl(entry.url);
  if (!url) {
    return null;
  }
  return { name, url };
}

function uniqueName(baseName: string, existing: SavedViewEntry[]): string {
  const existingLower = new Set(existing.map((entry) => entry.name.toLowerCase()));
  if (!existingLower.has(baseName.toLowerCase())) {
    return baseName;
  }

  let index = 2;
  while (index < 10_000) {
    const suffix = ` (${index})`;
    const sliceLength = Math.max(1, MAX_SAVED_VIEW_NAME_LENGTH - suffix.length);
    const candidate = `${baseName.slice(0, sliceLength)}${suffix}`;
    if (!existingLower.has(candidate.toLowerCase())) {
      return candidate;
    }
    index += 1;
  }
  return `${baseName.slice(0, MAX_SAVED_VIEW_NAME_LENGTH - 4)} (...)`;
}

function dedupeAndClamp(entries: SavedViewEntry[]): SavedViewEntry[] {
  const seen = new Set<string>();
  const next: SavedViewEntry[] = [];
  for (const entry of entries) {
    const normalized = normalizeEntry(entry);
    if (!normalized) {
      continue;
    }
    const key = `${normalized.name.toLowerCase()}::${normalized.url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(normalized);
    if (next.length >= MAX_SAVED_VIEWS) {
      break;
    }
  }
  return next;
}

export function loadSavedViews(storage: SavedViewsStorageLike): SavedViewEntry[] {
  const raw = storage.getItem(SAVED_VIEWS_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObjectRecord(parsed)) {
      return [];
    }
    if (parsed.schemaVersion !== SAVED_VIEWS_SCHEMA_VERSION || !Array.isArray(parsed.views)) {
      return [];
    }
    const entries = parsed.views.filter((item): item is SavedViewEntry => {
      if (!isObjectRecord(item)) {
        return false;
      }
      return typeof item.name === "string" && typeof item.url === "string";
    });
    return dedupeAndClamp(entries);
  } catch {
    return [];
  }
}

export function storeSavedViews(storage: SavedViewsStorageLike, views: SavedViewEntry[]): void {
  const normalized = dedupeAndClamp(views);
  const envelope: SavedViewsEnvelope = {
    schemaVersion: SAVED_VIEWS_SCHEMA_VERSION,
    views: normalized,
  };
  storage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(envelope));
}

export function addSavedView(existing: SavedViewEntry[], name: string, url: string): AddSavedViewResult {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return {
      views: dedupeAndClamp(existing),
      savedName: normalizeName(name),
    };
  }
  const baseName = normalizeName(name);
  const normalizedExisting = dedupeAndClamp(existing);
  const savedName = uniqueName(baseName, normalizedExisting);
  const entry: SavedViewEntry = { name: savedName, url: normalizedUrl };
  return {
    views: dedupeAndClamp([entry, ...normalizedExisting]),
    savedName,
  };
}

export function deleteSavedView(existing: SavedViewEntry[], name: string): SavedViewEntry[] {
  return dedupeAndClamp(existing).filter((entry) => entry.name !== name);
}
