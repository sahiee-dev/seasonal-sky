import { describe, expect, it } from "vitest";
import { weatherFromCode } from "../src/weather";

describe("weatherFromCode", () => {
  it("maps clear, cloud and fog", () => {
    expect(weatherFromCode(0).weather).toBe("clear");
    expect(weatherFromCode(1).weather).toBe("clear");
    expect(weatherFromCode(2)).toMatchObject({ weather: "cloudy", intensity: 0.6 });
    expect(weatherFromCode(3)).toMatchObject({ weather: "cloudy", intensity: 1 });
    expect(weatherFromCode(45).weather).toBe("fog");
    expect(weatherFromCode(48).weather).toBe("fog");
  });
  it("tells drizzle from downpour", () => {
    expect(weatherFromCode(51).intensity).toBeLessThan(weatherFromCode(63).intensity);
    expect(weatherFromCode(65).intensity).toBeGreaterThan(weatherFromCode(63).intensity);
    expect(weatherFromCode(82).weather).toBe("rain");
    expect(weatherFromCode(82).intensity).toBeGreaterThan(1.5);
  });
  it("flags freezing rain", () => {
    for (const c of [56, 57, 66, 67]) expect(weatherFromCode(c)).toMatchObject({ weather: "rain", freezing: true });
    expect(weatherFromCode(61).freezing).toBe(false);
  });
  it("maps snow and storms", () => {
    for (const c of [71, 73, 75, 77, 85, 86]) expect(weatherFromCode(c).weather).toBe("snow");
    for (const c of [95, 96, 99]) expect(weatherFromCode(c).weather).toBe("storm");
    expect(weatherFromCode(75).intensity).toBeGreaterThan(weatherFromCode(71).intensity);
  });
  it("treats unknown codes as clear rather than throwing", () => {
    expect(weatherFromCode(42).weather).toBe("clear");
  });
});
