import {
  addSavedView,
  deleteSavedView,
  loadSavedViews,
  MAX_SAVED_VIEWS,
  SAVED_VIEWS_STORAGE_KEY,
  storeSavedViews,
  type SavedViewEntry,
} from "../savedViewsStore";

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    length: data.size,
    clear() {
      data.clear();
      this.length = 0;
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
      this.length = data.size;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
      this.length = data.size;
    },
  };
}

describe("savedViewsStore", () => {
  it("loads valid envelope and drops malformed entries", () => {
    const storage = createMemoryStorage({
      [SAVED_VIEWS_STORAGE_KEY]: JSON.stringify({
        schemaVersion: 1,
        views: [
          { name: "Output Focus", url: "https://example.local/?view=output" },
          { name: "", url: "" },
          { bogus: true },
        ],
      }),
    });

    expect(loadSavedViews(storage)).toEqual([{ name: "Output Focus", url: "https://example.local/?view=output" }]);
  });

  it("adds views with deterministic duplicate-name suffixing", () => {
    const existing: SavedViewEntry[] = [{ name: "Primary", url: "https://example.local/?view=dashboard" }];
    const first = addSavedView(existing, "Primary", "https://example.local/?view=tasks");
    const second = addSavedView(first.views, "Primary", "https://example.local/?view=output");

    expect(first.savedName).toBe("Primary (2)");
    expect(second.savedName).toBe("Primary (3)");
    expect(second.views[0]).toEqual({ name: "Primary (3)", url: "https://example.local/?view=output" });
  });

  it("clamps saved views to max limit and keeps newest first", () => {
    let views: SavedViewEntry[] = [];
    for (let index = 1; index <= MAX_SAVED_VIEWS + 3; index += 1) {
      views = addSavedView(views, `View ${index}`, `https://example.local/?view=output&n=${index}`).views;
    }

    expect(views).toHaveLength(MAX_SAVED_VIEWS);
    expect(views[0]?.name).toBe(`View ${MAX_SAVED_VIEWS + 3}`);
    expect(views[MAX_SAVED_VIEWS - 1]?.name).toBe("View 4");
  });

  it("stores and deletes entries deterministically", () => {
    const storage = createMemoryStorage();
    const source: SavedViewEntry[] = [
      { name: "Dashboard", url: "https://example.local/?view=dashboard" },
      { name: "Output", url: "https://example.local/?view=output" },
    ];
    storeSavedViews(storage, source);

    const loaded = loadSavedViews(storage);
    expect(loaded).toEqual(source);

    const deleted = deleteSavedView(loaded, "Dashboard");
    expect(deleted).toEqual([{ name: "Output", url: "https://example.local/?view=output" }]);
  });
});
