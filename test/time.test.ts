import { describe, expect, it } from "vitest";
import {
  hemisphereFromLatitude,
  hemisphereFromTimeZone,
  phaseFromSun,
  phaseOf,
  seasonOf,
} from "../src/time";

const at = (iso: string) => new Date(iso);

describe("seasonOf", () => {
  it("uses meteorological seasons in the north", () => {
    expect(seasonOf(at("2026-03-01T12:00:00"))).toBe("spring");
    expect(seasonOf(at("2026-06-15T12:00:00"))).toBe("summer");
    expect(seasonOf(at("2026-11-30T12:00:00"))).toBe("autumn");
    expect(seasonOf(at("2026-12-01T12:00:00"))).toBe("winter");
    expect(seasonOf(at("2026-02-28T12:00:00"))).toBe("winter");
  });
  it("flips in the south", () => {
    expect(seasonOf(at("2026-03-01T12:00:00"), "south")).toBe("autumn");
    expect(seasonOf(at("2026-12-25T12:00:00"), "south")).toBe("summer");
    expect(seasonOf(at("2026-07-01T12:00:00"), "south")).toBe("winter");
  });
});

describe("phaseOf", () => {
  it("splits the day by the clock", () => {
    expect(phaseOf(at("2026-06-01T06:00:00"))).toBe("dawn");
    expect(phaseOf(at("2026-06-01T12:00:00"))).toBe("day");
    expect(phaseOf(at("2026-06-01T18:00:00"))).toBe("dusk");
    expect(phaseOf(at("2026-06-01T23:00:00"))).toBe("night");
    expect(phaseOf(at("2026-06-01T03:00:00"))).toBe("night");
  });
});

describe("phaseFromSun", () => {
  const H = 3_600_000;
  const rise = Date.UTC(2026, 10, 9, 11, 30);
  const set = Date.UTC(2026, 10, 9, 21, 30);
  it("follows the real sun", () => {
    expect(phaseFromSun(rise - 20 * 60_000, rise, set)).toBe("dawn");
    expect(phaseFromSun(rise + 2 * H, rise, set)).toBe("day");
    expect(phaseFromSun(set - 30 * 60_000, rise, set)).toBe("dusk");
    expect(phaseFromSun(set + 3 * H, rise, set)).toBe("night");
    expect(phaseFromSun(rise - 3 * H, rise, set)).toBe("night");
  });
  it("still works the next day, from stale times", () => {
    const day = 24 * H;
    expect(phaseFromSun(rise + day + 3 * H, rise, set)).toBe("day");
    expect(phaseFromSun(set + day + 4 * H, rise, set)).toBe("night");
    expect(phaseFromSun(rise + 3 * day - 10 * 60_000, rise, set)).toBe("dawn");
  });
});

describe("hemisphere", () => {
  it("reads latitude", () => {
    expect(hemisphereFromLatitude(42)).toBe("north");
    expect(hemisphereFromLatitude(-33.9)).toBe("south");
  });
  it("guesses from the timezone", () => {
    expect(hemisphereFromTimeZone("Australia/Sydney")).toBe("south");
    expect(hemisphereFromTimeZone("America/Sao_Paulo")).toBe("south");
    expect(hemisphereFromTimeZone("Africa/Johannesburg")).toBe("south");
    expect(hemisphereFromTimeZone("America/New_York")).toBe("north");
    expect(hemisphereFromTimeZone("Asia/Kolkata")).toBe("north");
    expect(hemisphereFromTimeZone(null)).toBe("north");
  });
});
