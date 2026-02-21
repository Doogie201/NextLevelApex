import { moveTaskSelection, nextVisibleTaskLimit } from "../taskSelection";

describe("taskSelection helpers", () => {
  it("moves selection forward and wraps", () => {
    const tasks = ["A", "B", "C"];

    expect(moveTaskSelection(tasks, "A", "next")).toBe("B");
    expect(moveTaskSelection(tasks, "C", "next")).toBe("A");
  });

  it("moves selection backward and wraps", () => {
    const tasks = ["A", "B", "C"];

    expect(moveTaskSelection(tasks, "B", "prev")).toBe("A");
    expect(moveTaskSelection(tasks, "A", "prev")).toBe("C");
  });

  it("handles empty and unknown selection safely", () => {
    expect(moveTaskSelection([], null, "next")).toBeNull();
    expect(moveTaskSelection(["A", "B"], "missing", "next")).toBe("A");
    expect(moveTaskSelection(["A", "B"], "missing", "prev")).toBe("B");
  });

  it("advances task window size without exceeding total", () => {
    expect(nextVisibleTaskLimit(0, 1240)).toBe(200);
    expect(nextVisibleTaskLimit(200, 1240)).toBe(400);
    expect(nextVisibleTaskLimit(1200, 1240)).toBe(1240);
    expect(nextVisibleTaskLimit(0, 10, 7)).toBe(7);
    expect(nextVisibleTaskLimit(8, 10, 7)).toBe(10);
  });
});
