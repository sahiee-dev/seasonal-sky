/**
 * Shared types. Plain data only: nothing here touches the DOM.
 */

export type Tone = "light" | "dark";
export type Season = "spring" | "summer" | "autumn" | "winter";
export type Phase = "dawn" | "day" | "dusk" | "night";
export type Weather = "clear" | "cloudy" | "fog" | "rain" | "snow" | "storm";
export type Hemisphere = "north" | "south";

/** What a particle looks like. `rain` and `sleet` are streaks, `firefly` is a
 *  blinking glow, everything else is a pre-rendered sprite. */
export type Kind =
  | "maple"
  | "oak"
  | "ginkgo"
  | "leaf"
  | "petal"
  | "flake"
  | "rain"
  | "sleet"
  | "firefly";

/** One population of particles. Layers with the same `id` replace each other
 *  (with a cross-fade) when the recipe changes, so "what is falling" can change
 *  without the other layers noticing. */
export type Layer = {
  id: string;
  /** Shapes to mix; each particle picks one. */
  kinds: Kind[];
  /** How many at a 1440x900 viewport; scaled to the real one. */
  count: number;
  /** CSS pixels. For rain, the streak length. */
  size: [number, number];
  /** Pixels per frame at 60fps. */
  speed: [number, number];
  /** Side-to-side wobble, pixels per frame. */
  sway: [number, number];
  /** Spin, degrees per frame. */
  spin: [number, number];
  alpha: [number, number];
  /** Hex colours; each particle picks one. */
  colors: string[];
  /** How strongly the wind moves it, 0 (ignores it) to ~1.2 (carried off). */
  wind: number;
};

export type Haze = { kind: "fog" | "cloudy"; intensity: number };

/** A complete description of the sky. Plain data: building one is a pure
 *  function of season, time of day and weather (see `buildRecipe`). */
export type Recipe = {
  tone: Tone;
  layers: Layer[];
  /** Steady wind, pixels per frame. Positive blows right. */
  wind: number;
  /** How far gusts swing around that steady wind. */
  gust: number;
  lightning: boolean;
  /** 0 to 1: how visible the rainbow is. */
  rainbow: number;
  /** Fog or overcast, drawn as CSS by `mountSky`. */
  haze: Haze | null;
};

/** What a weather feed reports for one place. */
export type Conditions = {
  weather: Weather;
  /** 0.3 (drizzle, flurries) through 1 (ordinary) to 1.7 (downpour, heavy snow). */
  intensity: number;
  /** Freezing rain or drizzle: falls as ice pellets whatever the season. */
  freezing: boolean;
  windKmh: number;
  temperatureC?: number;
  /** Today's sunrise and sunset, epoch milliseconds. */
  sunrise?: number;
  sunset?: number;
  /** Latitude of the place the reading is for, degrees. */
  latitude?: number;
};

/** Swap this in to use a different weather service than Open-Meteo. */
export type WeatherProvider = (
  lat: number,
  lon: number,
  signal?: AbortSignal
) => Promise<Conditions>;

export type Place = { lat: number; lon: number; name: string };

/** How the weather was located. */
export type Source = "precise" | "timezone" | "fixed" | null;

export type LiveStatus = "idle" | "locating" | "ready" | "unavailable" | "error";
