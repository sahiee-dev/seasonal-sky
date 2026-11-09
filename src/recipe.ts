import type { Haze, Kind, Layer, Phase, Recipe, Season, Tone, Weather } from "./types";

/**
 * The matrix. Season decides what is falling when the sky is quiet; weather
 * decides what else is happening; time of day dims and slows all of it. They
 * are composed, not looked up, so every pairing is its own scene:
 *
 *              clear     rain              snow          storm
 *   spring     petals    rain, rainbow     snow          rain, petals
 *                        by day                          thrown by wind
 *   summer     leaves,   sun shower:       snow          thunderstorm,
 *              fireflies rain + rainbow                  leaves thrown
 *              at night
 *   autumn     leaves    rain, faint       snow          rain, leaves
 *                        rainbow                         thrown sideways
 *   winter     snow      sleet (or rain    heavy snow    blizzard
 *                        if it's mild)
 *
 * Rain and snow replace the season's particles; they don't mix with them:
 * nothing should float down gently beside precipitation. Storms are the
 * exception, where leaves appear only as debris blown fast by the wind.
 *
 * When a temperature is known it overrides the calendar: rain colder than
 * about 1.5 degrees falls as sleet, mild winter rain stays rain.
 */

type Look = {
  kinds: Kind[];
  count: number;
  size: [number, number];
  speed: [number, number];
  sway: [number, number];
  spin: [number, number];
  alpha: [number, number];
  wind: number;
  /** Split by page tone: a pale flake vanishes on ivory paper. */
  colors: Record<Tone, string[]>;
};

const LOOK: Record<Season, Look> = {
  autumn: {
    kinds: ["maple", "oak", "ginkgo"],
    count: 24,
    size: [14, 30],
    speed: [0.6, 1.5],
    sway: [0.4, 1.4],
    spin: [-1.5, 1.5],
    alpha: [0.7, 0.92],
    wind: 0.9,
    colors: {
      light: ["#c2410c", "#b91c1c", "#d97706", "#9a3412", "#a16207"],
      dark: ["#ea580c", "#dc2626", "#f59e0b", "#c2410c", "#ca8a04"],
    },
  },
  winter: {
    kinds: ["flake"],
    count: 50,
    size: [5, 11],
    speed: [0.4, 1.1],
    sway: [0.2, 0.7],
    spin: [0, 0],
    alpha: [0.6, 0.95],
    wind: 1,
    colors: {
      light: ["#5f86ad", "#7099bd", "#4f7aa3", "#86a9c8"],
      dark: ["#ffffff", "#e8f1fa", "#d4e4f3"],
    },
  },
  spring: {
    kinds: ["petal"],
    count: 26,
    size: [8, 15],
    speed: [0.35, 0.9],
    sway: [0.5, 1.2],
    spin: [-1.2, 1.2],
    alpha: [0.7, 0.92],
    wind: 0.95,
    colors: {
      light: ["#e58fa8", "#f0a7bb", "#d97894", "#ecb2c3"],
      dark: ["#f9c0d0", "#fbd5df", "#f4a6bd", "#fde4ea"],
    },
  },
  summer: {
    kinds: ["leaf"],
    count: 12,
    size: [12, 24],
    speed: [0.5, 1.2],
    sway: [0.4, 1.2],
    spin: [-1.2, 1.2],
    alpha: [0.65, 0.88],
    wind: 0.9,
    colors: {
      light: ["#4d7c0f", "#65a30d", "#3f6212", "#84a825"],
      dark: ["#84cc16", "#a3e635", "#65a30d", "#bef264"],
    },
  },
};

/** How the time of day bends everything. */
const PHASE: Record<Phase, { count: number; speed: number; alpha: number }> = {
  dawn: { count: 0.8, speed: 0.85, alpha: 0.9 },
  day: { count: 1, speed: 1, alpha: 1 },
  dusk: { count: 0.9, speed: 0.9, alpha: 0.95 },
  night: { count: 0.7, speed: 0.75, alpha: 0.85 },
};

/** Steady wind and gust swing per weather, pixels per frame. */
const WIND: Record<Weather, [number, number]> = {
  clear: [0.15, 0.25],
  cloudy: [0.35, 0.35],
  fog: [0.05, 0.1],
  rain: [0.7, 0.5],
  snow: [0.3, 0.4],
  storm: [2.0, 1.3],
};

/** A rainbow needs sun and rain together: strongest in a summer shower, faint
 *  in autumn, and at night there is nothing to light it. */
const RAINBOW_SEASON: Record<Season, number> = {
  summer: 1,
  spring: 0.8,
  autumn: 0.55,
  winter: 0.3, // only reached when a temperature says the rain really is rain
};
const RAINBOW_PHASE: Record<Phase, number> = {
  dawn: 0.7,
  day: 1,
  dusk: 0.85,
  night: 0,
};

/** Below this, rain is falling as ice. */
const SLEET_BELOW_C = 1.5;
/** Below this, a rainbow is a stretch even with sun and showers. */
const NO_RAINBOW_BELOW_C = 4;

const mul = (r: [number, number], k: number): [number, number] => [r[0] * k, r[1] * k];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (r: [number, number]): [number, number] => [
  Math.min(1, r[0]),
  Math.min(1, r[1]),
];

type Mods = { count?: number; speed?: number; sway?: number; alpha?: number; wind?: number };

function fall(
  id: string,
  look: Look,
  tone: Tone,
  phase: Phase,
  m: Mods = {}
): Layer {
  const p = PHASE[phase];
  return {
    id,
    kinds: look.kinds,
    count: Math.round(look.count * p.count * (m.count ?? 1)),
    size: look.size,
    speed: mul(look.speed, p.speed * (m.speed ?? 1)),
    sway: mul(look.sway, m.sway ?? 1),
    spin: look.spin,
    alpha: clamp01(mul(look.alpha, p.alpha * (m.alpha ?? 1))),
    colors: look.colors[tone],
    wind: m.wind ?? look.wind,
  };
}

/** `k` is intensity: drizzle ~0.35, ordinary 1, downpour ~1.7. It thins or
 *  thickens the rain and makes the drops shorter and slower, or longer and
 *  faster. */
function rain(tone: Tone, heavy: boolean, kind: "rain" | "sleet", k: number): Layer {
  const sleet = kind === "sleet";
  const shape = 0.75 + 0.25 * Math.min(k, 1.5);
  return {
    id: "precip",
    kinds: [kind],
    count: Math.round((sleet ? 170 : heavy ? 280 : 170) * k),
    size: mul(sleet ? [8, 16] : heavy ? [12, 26] : [10, 22], shape),
    speed: mul(sleet ? [11, 16] : heavy ? [20, 30] : [14, 22], shape),
    sway: [0, 0],
    spin: [0, 0],
    alpha: clamp01(mul(sleet ? [0.3, 0.6] : [0.25, 0.55], 0.8 + 0.2 * Math.min(k, 1.3))),
    colors: [tone === "light" ? "#466996" : "#c8dcf5"],
    wind: 1,
  };
}

function fireflies(tone: Tone, phase: Phase): Layer {
  return {
    id: "accent",
    kinds: ["firefly"],
    count: phase === "night" ? 26 : 14,
    size: [16, 30],
    speed: [0.1, 0.35],
    sway: [0, 0],
    spin: [0, 0],
    alpha: [0.8, 1],
    colors: tone === "light" ? ["#d4a90a", "#c49a06"] : ["#d6ff5a", "#eaff8a"],
    wind: 0,
  };
}

export type RecipeInput = {
  season: Season;
  phase: Phase;
  weather: Weather;
  tone: Tone;
  /** How hard it's falling, about 0.3 to 1.7. Default 1. */
  intensity?: number;
  /** Freezing rain: ice pellets whatever the season. */
  freezing?: boolean;
  /** Air temperature, degrees C. When known it decides rain versus sleet. */
  temperatureC?: number;
  /** Real wind from a weather feed, km/h; 0 when there isn't one. */
  windKmh?: number;
};

export function buildRecipe({
  season,
  phase,
  weather,
  tone,
  intensity = 1,
  freezing = false,
  temperatureC,
  windKmh = 0,
}: RecipeInput): Recipe {
  const look = LOOK[season];
  const winter = LOOK.winter;
  const k = clamp(intensity, 0.3, 1.7);
  const layers: Layer[] = [];
  let [wind, gust] = WIND[weather];
  let haze: Haze | null = null;
  let lightning = false;
  let rainbow = 0;

  switch (weather) {
    case "clear":
      layers.push(fall("base", look, tone, phase));
      break;

    case "cloudy":
      layers.push(fall("base", look, tone, phase, { count: 0.9 }));
      haze = { kind: "cloudy", intensity: 0.35 + 0.55 * Math.min(k, 1) };
      break;

    case "fog":
      layers.push(fall("base", look, tone, phase, { count: 0.7, alpha: 0.8 }));
      haze = { kind: "fog", intensity: 1 };
      break;

    // In rain and snow the season's own particles are left out on purpose.
    // Leaves and petals drifting down at a stroll beside rain falling twenty
    // times faster just looks wrong, and wet leaves are on the ground, not in
    // the air. Precipitation is the whole sky; the season still shows in the
    // rainbow and the sky's colour.
    case "rain": {
      const icy =
        freezing || (temperatureC !== undefined ? temperatureC <= SLEET_BELOW_C : season === "winter");
      if (icy) {
        // too warm for snow, too cold for rain: ice pellets, no floating flakes
        layers.push(rain(tone, false, "sleet", k));
        haze = { kind: "cloudy", intensity: clamp(0.65 + 0.2 * k, 0, 1) };
      } else {
        layers.push(rain(tone, false, "rain", k));
        haze = { kind: "cloudy", intensity: clamp(0.45 + 0.25 * k, 0, 1) };
        const mild = temperatureC === undefined || temperatureC >= NO_RAINBOW_BELOW_C;
        const seasonal =
          season === "winter" && temperatureC === undefined ? 0 : RAINBOW_SEASON[season];
        rainbow = mild ? seasonal * RAINBOW_PHASE[phase] * (k > 1.3 ? 0.6 : 1) : 0;
      }
      break;
    }

    case "snow":
      haze = { kind: "cloudy", intensity: 0.5 };
      layers.push(
        fall("precip", winter, tone, phase, {
          count: (season === "winter" ? 1.5 : 1.1) * (0.5 + 0.5 * k),
        })
      );
      break;

    case "storm":
      if (season === "winter") {
        // blizzard: dense snow driven nearly sideways into a whiteout
        wind = 3.2;
        gust = 1.8;
        layers.push(
          fall("precip", winter, tone, phase, { count: 2.6, speed: 1.6, sway: 0.5 })
        );
        haze = { kind: "fog", intensity: 1 };
      } else {
        // A storm is the one exception: it strips leaves and petals off and
        // throws them. They aren't drifting down, they're debris, so they
        // fall fast and are carried hard by the wind instead of floating.
        const torn = { autumn: 1, spring: 0.7, summer: 0.4 }[season];
        layers.push(
          fall("base", look, tone, phase, { count: torn, speed: 2.6, sway: 0.2, wind: 1.6 })
        );
        layers.push(rain(tone, true, "rain", 0.85 + 0.15 * k));
        lightning = true;
        haze = { kind: "cloudy", intensity: 1 };
      }
      break;
  }

  // Summer evenings: fireflies come out when it's dry enough to see them.
  if (
    season === "summer" &&
    (phase === "night" || phase === "dusk") &&
    (weather === "clear" || weather === "cloudy")
  ) {
    const base = layers.find((l) => l.id === "base");
    if (base) base.count = Math.round(base.count * 0.35);
    layers.push(fireflies(tone, phase));
  }

  // Real wind, when we have it, stacks on the scene's own.
  wind += Math.min(windKmh / 12, 2.5);
  gust += Math.min(windKmh / 40, 0.8);

  return { tone, layers, wind, gust, lightning, rainbow, haze };
}
