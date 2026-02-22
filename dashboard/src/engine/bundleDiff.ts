import {
  buildBundlePreviewText,
  normalizeBundleValue,
  stableStringifyNormalized,
  type NormalizedBundleValue,
} from "./bundleNormalize";

export type BundleDiffKind = "added" | "removed" | "changed";

export interface BundleDiffEntry {
  path: string;
  kind: BundleDiffKind;
  left?: string;
  right?: string;
}

export interface BundleDiffSummary {
  added: number;
  removed: number;
  changed: number;
  total: number;
}

export interface BundleDiffResult {
  summary: BundleDiffSummary;
  entries: BundleDiffEntry[];
  truncated: boolean;
  leftPreview: string;
  rightPreview: string;
}

export interface BundleDiffOptions {
  maxEntries: number;
  maxValueChars: number;
  maxPreviewChars: number;
}

const DEFAULT_OPTIONS: BundleDiffOptions = {
  maxEntries: 220,
  maxValueChars: 240,
  maxPreviewChars: 14_000,
};

function mergedOptions(overrides?: Partial<BundleDiffOptions>): BundleDiffOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...overrides,
  };
}

function previewValue(value: NormalizedBundleValue | undefined, maxValueChars: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = stableStringifyNormalized(value);
  if (raw.length <= maxValueChars) {
    return raw;
  }
  return `${raw.slice(0, maxValueChars)} … [TRUNCATED ${raw.length - maxValueChars} chars]`;
}

function appendEntry(
  entries: BundleDiffEntry[],
  entry: BundleDiffEntry,
  options: BundleDiffOptions,
  state: { truncated: boolean },
): void {
  if (entries.length >= options.maxEntries) {
    state.truncated = true;
    return;
  }
  entries.push(entry);
}

function compareNodes(
  left: NormalizedBundleValue | undefined,
  right: NormalizedBundleValue | undefined,
  path: string,
  entries: BundleDiffEntry[],
  options: BundleDiffOptions,
  state: { truncated: boolean },
): void {
  if (state.truncated) {
    return;
  }

  if (left === undefined && right !== undefined) {
    appendEntry(
      entries,
      {
        path,
        kind: "added",
        right: previewValue(right, options.maxValueChars),
      },
      options,
      state,
    );
    return;
  }

  if (left !== undefined && right === undefined) {
    appendEntry(
      entries,
      {
        path,
        kind: "removed",
        left: previewValue(left, options.maxValueChars),
      },
      options,
      state,
    );
    return;
  }

  if (left === undefined || right === undefined) {
    return;
  }

  const leftIsArray = Array.isArray(left);
  const rightIsArray = Array.isArray(right);

  if (leftIsArray || rightIsArray) {
    if (!leftIsArray || !rightIsArray) {
      appendEntry(
        entries,
        {
          path,
          kind: "changed",
          left: previewValue(left, options.maxValueChars),
          right: previewValue(right, options.maxValueChars),
        },
        options,
        state,
      );
      return;
    }

    const maxLength = Math.max(left.length, right.length);
    for (let index = 0; index < maxLength; index += 1) {
      compareNodes(left[index], right[index], `${path}[${index}]`, entries, options, state);
      if (state.truncated) {
        return;
      }
    }
    return;
  }

  const leftIsObject = left !== null && typeof left === "object";
  const rightIsObject = right !== null && typeof right === "object";

  if (leftIsObject || rightIsObject) {
    if (!leftIsObject || !rightIsObject) {
      appendEntry(
        entries,
        {
          path,
          kind: "changed",
          left: previewValue(left, options.maxValueChars),
          right: previewValue(right, options.maxValueChars),
        },
        options,
        state,
      );
      return;
    }

    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    const orderedKeys = [...keys].sort((a, b) => a.localeCompare(b));
    for (const key of orderedKeys) {
      const nextPath = path ? `${path}.${key}` : key;
      compareNodes(
        (left as Record<string, NormalizedBundleValue>)[key],
        (right as Record<string, NormalizedBundleValue>)[key],
        nextPath,
        entries,
        options,
        state,
      );
      if (state.truncated) {
        return;
      }
    }
    return;
  }

  if (left !== right) {
    appendEntry(
      entries,
      {
        path,
        kind: "changed",
        left: previewValue(left, options.maxValueChars),
        right: previewValue(right, options.maxValueChars),
      },
      options,
      state,
    );
  }
}

function summarize(entries: BundleDiffEntry[]): BundleDiffSummary {
  const summary: BundleDiffSummary = {
    added: 0,
    removed: 0,
    changed: 0,
    total: entries.length,
  };

  for (const entry of entries) {
    if (entry.kind === "added") {
      summary.added += 1;
    } else if (entry.kind === "removed") {
      summary.removed += 1;
    } else {
      summary.changed += 1;
    }
  }

  return summary;
}

export function buildBundleDiff(
  leftInput: unknown,
  rightInput: unknown,
  overrides?: Partial<BundleDiffOptions>,
): BundleDiffResult {
  const options = mergedOptions(overrides);
  const leftNormalized = normalizeBundleValue(leftInput);
  const rightNormalized = normalizeBundleValue(rightInput);

  const entries: BundleDiffEntry[] = [];
  const state = { truncated: false };

  compareNodes(leftNormalized.normalized, rightNormalized.normalized, "$", entries, options, state);

  const leftPreview = buildBundlePreviewText(leftNormalized.normalized, {
    maxOutputChars: options.maxPreviewChars,
  }).text;
  const rightPreview = buildBundlePreviewText(rightNormalized.normalized, {
    maxOutputChars: options.maxPreviewChars,
  }).text;

  const previewTruncated =
    leftPreview.includes("TRUNCATED_OUTPUT") ||
    rightPreview.includes("TRUNCATED_OUTPUT") ||
    leftNormalized.truncated ||
    rightNormalized.truncated;

  return {
    summary: summarize(entries),
    entries,
    truncated: state.truncated || previewTruncated,
    leftPreview,
    rightPreview,
  };
}
