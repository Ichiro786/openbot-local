import { describe, expect, it } from "vitest";
import { donutArcs } from "./donut-arcs";

describe("donutArcs", () => {
  it("fills the ring with one segment and no gap", () => {
    expect(donutArcs([{ key: "a", color: "#000", value: 5 }])).toEqual([{ key: "a", color: "#000", start: 0, end: 1 }]);
  });

  it("splits by value with equal gaps and never passes 1", () => {
    const arcs = donutArcs(
      [
        { key: "a", color: "#000", value: 1 },
        { key: "b", color: "#111", value: 1 },
      ],
      0.02,
    );
    expect(arcs[0]?.start).toBeCloseTo(0.01);
    expect(arcs[0]?.end).toBeCloseTo(0.49);
    expect(arcs[1]?.start).toBeCloseTo(0.51);
    expect(arcs[1]?.end).toBeCloseTo(0.99);
  });

  it("keeps an empty segment as a zero-length arc where the next one starts", () => {
    const arcs = donutArcs([
      { key: "a", color: "#000", value: 3 },
      { key: "b", color: "#111", value: 0 },
      { key: "c", color: "#222", value: 1 },
    ]);
    expect(arcs[1]?.start).toBe(arcs[1]?.end);
    expect(arcs[1]?.start ?? 0).toBeLessThanOrEqual(arcs[2]?.start ?? 0);
  });

  it("draws nothing for an empty or negative total", () => {
    expect(donutArcs([{ key: "a", color: "#000", value: 0 }])).toEqual([{ key: "a", color: "#000", start: 0, end: 0 }]);
    expect(donutArcs([{ key: "a", color: "#000", value: -2 }])[0]?.end).toBe(0);
  });
});
