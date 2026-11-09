import { describe, expect, it } from "vitest";
import { lightnessOf, toneOfColor } from "../src/tone";

describe("tone", () => {
  it("reads hex and rgb()", () => {
    expect(toneOfColor("#ffffff")).toBe("light");
    expect(toneOfColor("#0b0b10")).toBe("dark");
    expect(toneOfColor("rgb(20, 20, 30)")).toBe("dark");
    expect(toneOfColor("rgb(250 248 240)")).toBe("light");
    expect(toneOfColor("rgba(0, 0, 0, 0.9)")).toBe("dark");
  });
  it("treats transparent as unknown", () => {
    expect(lightnessOf("rgba(0, 0, 0, 0)")).toBeNull();
    expect(lightnessOf("transparent")).toBeNull();
    expect(lightnessOf("rgb(0 0 0 / 0)")).toBeNull();
  });
  it("calls mid-grey boundaries consistently", () => {
    expect(toneOfColor("#7e7e7e")).toBe("dark");
    expect(toneOfColor("#828282")).toBe("light");
  });
});
