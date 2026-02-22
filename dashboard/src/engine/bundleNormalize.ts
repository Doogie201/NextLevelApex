import { redactOutput } from "./redaction";

export type NormalizedBundleValue =
  | null
  | boolean
  | number
  | string
  | NormalizedBundleValue[]
  | { [key: string]: NormalizedBundleValue };

export interface BundleNormalizeOptions {
  maxDepth: number;
  maxArrayItems: number;
  maxObjectKeys: number;
  maxStringLength: number;
  maxOutputChars: number;
}

export interface BundleNormalizedResult {
  normalized: NormalizedBundleValue;
  truncated: boolean;
}

export interface BundlePreviewResult {
  text: string;
  truncated: boolean;
}

const DEFAULT_OPTIONS: BundleNormalizeOptions = {
  maxDepth: 8,
  maxArrayItems: 160,
  maxObjectKeys: 120,
  maxStringLength: 900,
  maxOutputChars: 20_000,
};

function mergedOptions(overrides?: Partial<BundleNormalizeOptions>): BundleNormalizeOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...overrides,
  };
}

function normalizeString(value: string, options: BundleNormalizeOptions, state: { truncated: boolean }): string {
  const redacted = redactOutput(value);
  if (redacted.length <= options.maxStringLength) {
    return redacted;
  }
  state.truncated = true;
  const remaining = redacted.length - options.maxStringLength;
  return `${redacted.slice(0, options.maxStringLength)} … [TRUNCATED ${remaining} chars]`;
}

function sortArrayEntries(entries: NormalizedBundleValue[]): NormalizedBundleValue[] {
  return [...entries].sort((left, right) => stableStringifyNormalized(left).localeCompare(stableStringifyNormalized(right)));
}

function normalizeUnknown(
  value: unknown,
  options: BundleNormalizeOptions,
  depth: number,
  state: { truncated: boolean },
): NormalizedBundleValue {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return normalizeString(value, options, state);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      state.truncated = true;
      return "[NON_FINITE_NUMBER]";
    }
    return value;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (depth >= options.maxDepth) {
    state.truncated = true;
    return "[TRUNCATED_DEPTH]";
  }

  if (Array.isArray(value)) {
    const normalized = value.map((entry) => normalizeUnknown(entry, options, depth + 1, state));
    const ordered = sortArrayEntries(normalized);
    if (ordered.length <= options.maxArrayItems) {
      return ordered;
    }

    state.truncated = true;
    const clipped = ordered.slice(0, options.maxArrayItems);
    clipped.push(`[TRUNCATED_ITEMS:${ordered.length - options.maxArrayItems}]`);
    return clipped;
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source).sort((left, right) => left.localeCompare(right));
    const limitedKeys = keys.slice(0, options.maxObjectKeys);
    const next: Record<string, NormalizedBundleValue> = {};

    for (const key of limitedKeys) {
      next[key] = normalizeUnknown(source[key], options, depth + 1, state);
    }

    if (keys.length > options.maxObjectKeys) {
      state.truncated = true;
      next.__truncatedKeys = `[TRUNCATED_KEYS:${keys.length - options.maxObjectKeys}]`;
    }

    return next;
  }

  state.truncated = true;
  return `[UNSUPPORTED_TYPE:${typeof value}]`;
}

export function stableStringifyNormalized(value: NormalizedBundleValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringifyNormalized(entry)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringifyNormalized(entry)}`).join(",")}}`;
}

export function normalizeBundleValue(
  value: unknown,
  overrides?: Partial<BundleNormalizeOptions>,
): BundleNormalizedResult {
  const options = mergedOptions(overrides);
  const state = { truncated: false };
  return {
    normalized: normalizeUnknown(value, options, 0, state),
    truncated: state.truncated,
  };
}

export function buildBundlePreviewText(
  value: unknown,
  overrides?: Partial<BundleNormalizeOptions>,
): BundlePreviewResult {
  const options = mergedOptions(overrides);
  const normalized = normalizeBundleValue(value, overrides);
  const rendered = JSON.stringify(normalized.normalized, null, 2);

  if (rendered.length <= options.maxOutputChars) {
    return {
      text: rendered,
      truncated: normalized.truncated,
    };
  }

  const remaining = rendered.length - options.maxOutputChars;
  return {
    text: `${rendered.slice(0, options.maxOutputChars)}\n… [TRUNCATED_OUTPUT ${remaining} chars]`,
    truncated: true,
  };
}
