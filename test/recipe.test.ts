import { describe, expect, it } from "vitest";
import { buildRecipe } from "../src/recipe";
import { PHASES, SEASONS } from "../src/time";
import type { Phase, Weather } from "../src/types";

const WEATHERS: Weather[] = ["clear", "cloudy", "fog", "rain", "snow", "storm"];
const base = { season: "autumn", phase: "day", tone: "light" } as const;
const kinds = (r: ReturnType<typeof buildRecipe>) => r.layers.flatMap((l) => l.kinds);

describe("buildRecipe", () => {
  it("builds every season x time x weather x tone without gaps", () => {
    for (const season of SEASONS)
      for (const phase of PHASES)
        for (const weather of WEATHERS)
          for (const tone of ["light", "dark"] as const) {
            const r = buildRecipe({ season, phase, weather, tone });
            expect(r.layers.length).toBeGreaterThan(0);
            for (const l of r.layers) {
              expect(l.count).toBeGreaterThan(0);
              expect(l.colors.length).toBeGreaterThan(0);
            }
            expect(r.rainbow).toBeGreaterThanOrEqual(0);
            expect(r.rainbow).toBeLessThanOrEqual(1);
          }
  });

  it("is pure: same input, same recipe", () => {
    const a = buildRecipe({ ...base, weather: "storm" });
    const b = buildRecipe({ ...base, weather: "storm" });
    expect(a).toEqual(b);
  });

  it("autumn clear drops leaves", () => {
    expect(kinds(buildRecipe({ ...base, weather: "clear" }))).toEqual(["maple", "oak", "ginkgo"]);
  });

  it("rain and snow replace the season's leaves", () => {
    expect(kinds(buildRecipe({ ...base, weather: "rain" }))).toEqual(["rain"]);
    expect(kinds(buildRecipe({ ...base, weather: "snow" }))).toEqual(["flake"]);
  });

  it("a storm keeps leaves only as fast debris", () => {
    const r = buildRecipe({ ...base, weather: "storm" });
    expect(r.lightning).toBe(true);
    const debris = r.layers.find((l) => l.id === "base")!;
    const calm = buildRecipe({ ...base, weather: "clear" }).layers[0];
    expect(debris.speed[0]).toBeGreaterThan(calm.speed[1]);
    expect(r.layers.some((l) => l.kinds[0] === "rain")).toBe(true);
  });

  it("winter storm is a blizzard: no lightning, no rain", () => {
    const r = buildRecipe({ ...base, season: "winter", weather: "storm" });
    expect(r.lightning).toBe(false);
    expect(kinds(r)).toEqual(["flake"]);
    expect(r.haze?.kind).toBe("fog");
  });

  it("summer shower by day makes the strongest rainbow", () => {
    const summer = buildRecipe({ ...base, season: "summer", weather: "rain" }).rainbow;
    const autumn = buildRecipe({ ...base, weather: "rain" }).rainbow;
    expect(summer).toBeGreaterThan(autumn);
    expect(autumn).toBeGreaterThan(0);
    expect(buildRecipe({ ...base, season: "summer", phase: "night", weather: "rain" }).rainbow).toBe(0);
    expect(buildRecipe({ ...base, season: "summer", weather: "clear" }).rainbow).toBe(0);
  });

  it("winter rain is sleet unless a temperature says it's mild", () => {
    const w = { ...base, season: "winter" as const, weather: "rain" as const };
    expect(kinds(buildRecipe(w))).toEqual(["sleet"]);
    expect(buildRecipe(w).rainbow).toBe(0);
    expect(kinds(buildRecipe({ ...w, temperatureC: 9 }))).toEqual(["rain"]);
    expect(buildRecipe({ ...w, temperatureC: 9 }).rainbow).toBeGreaterThan(0);
  });

  it("cold rain is sleet in any season, and freezing rain always is", () => {
    const w = { ...base, season: "summer" as const, weather: "rain" as const };
    expect(kinds(buildRecipe({ ...w, temperatureC: 0 }))).toEqual(["sleet"]);
    expect(kinds(buildRecipe({ ...w, freezing: true }))).toEqual(["sleet"]);
    expect(buildRecipe({ ...w, temperatureC: 2 }).rainbow).toBe(0); // too cold for one
  });

  it("intensity thins drizzle and thickens downpours", () => {
    const n = (intensity: number) =>
      buildRecipe({ ...base, weather: "rain", intensity }).layers[0].count;
    expect(n(0.35)).toBeLessThan(n(1));
    expect(n(1.7)).toBeGreaterThan(n(1));
    const snow = (intensity: number) =>
      buildRecipe({ ...base, weather: "snow", intensity }).layers[0].count;
    expect(snow(0.5)).toBeLessThan(snow(1.6));
  });

  it("fireflies come out on dry summer evenings only", () => {
    const has = (o: { phase: Phase; weather: Weather }) => kinds(buildRecipe({ ...base, season: "summer", ...o })).includes("firefly");
    expect(has({ phase: "night", weather: "clear" })).toBe(true);
    expect(has({ phase: "dusk", weather: "cloudy" })).toBe(true);
    expect(has({ phase: "day", weather: "clear" })).toBe(false);
    expect(has({ phase: "night", weather: "rain" })).toBe(false);
  });

  it("real wind stacks on the scene's, capped", () => {
    const calm = buildRecipe({ ...base, weather: "clear" });
    expect(buildRecipe({ ...base, weather: "clear", windKmh: 24 }).wind).toBeGreaterThan(calm.wind);
    expect(buildRecipe({ ...base, weather: "clear", windKmh: 400 }).wind).toBeLessThan(calm.wind + 2.6);
  });

  it("uses tone-appropriate colours", () => {
    const light = buildRecipe({ ...base, season: "winter", weather: "clear", tone: "light" });
    const dark = buildRecipe({ ...base, season: "winter", weather: "clear", tone: "dark" });
    expect(light.layers[0].colors).not.toContain("#ffffff");
    expect(dark.layers[0].colors).toContain("#ffffff");
  });
});
