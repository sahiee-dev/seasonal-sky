import type { Conditions, Place, Weather, WeatherProvider } from "./types";

type Decoded = Pick<Conditions, "weather" | "intensity" | "freezing">;

/**
 * Collapses a WMO weather code (what Open-Meteo reports) into the six looks
 * the sky can draw, plus how hard it is falling. Drizzle is a trickle, heavy
 * rain is a wall; freezing rain is flagged so it can fall as ice.
 * https://open-meteo.com/en/docs#weathervariables
 */
export function weatherFromCode(code: number): Decoded {
  const w = (weather: Weather, intensity = 1, freezing = false): Decoded => ({
    weather,
    intensity,
    freezing,
  });
  switch (code) {
    case 0:
    case 1:
      return w("clear");
    case 2:
      return w("cloudy", 0.6); // partly cloudy: a thin veil
    case 3:
      return w("cloudy", 1);
    case 45:
    case 48:
      return w("fog");
    case 51: return w("rain", 0.35);
    case 53: return w("rain", 0.5);
    case 55: return w("rain", 0.7);
    case 56: return w("rain", 0.5, true);
    case 57: return w("rain", 0.8, true);
    case 61: return w("rain", 0.7);
    case 63: return w("rain", 1);
    case 65: return w("rain", 1.5);
    case 66: return w("rain", 0.9, true);
    case 67: return w("rain", 1.4, true);
    case 71: return w("snow", 0.5);
    case 73: return w("snow", 1);
    case 75: return w("snow", 1.6);
    case 77: return w("snow", 0.6);
    case 80: return w("rain", 0.8);
    case 81: return w("rain", 1.2);
    case 82: return w("rain", 1.7);
    case 85: return w("snow", 0.9);
    case 86: return w("snow", 1.6);
    case 95: return w("storm", 1);
    case 96: return w("storm", 1.2);
    case 99: return w("storm", 1.5);
    default:
      return code > 99 ? w("storm") : w("clear");
  }
}

const TTL_MS = 10 * 60 * 1000;

/**
 * Current conditions near a point, from Open-Meteo (free, no key, CORS open).
 *
 * Coordinates are rounded to one decimal place (roughly 10 km) before they
 * leave the browser: a forecast doesn't need a street address, so none is sent.
 * Answers are kept in sessionStorage for ten minutes so page loads in one visit
 * don't each hit the network.
 */
export const openMeteo: WeatherProvider = async (lat, lon, signal) => {
  const latitude = lat.toFixed(1);
  const longitude = lon.toFixed(1);
  const cacheKey = `seasonal-sky:wx:${latitude},${longitude}`;
  try {
    const hit = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
    if (hit && Date.now() - hit.t < TTL_MS) return hit.v as Conditions;
  } catch {
    /* no storage, or a bad entry: just fetch */
  }

  const q = new URLSearchParams({
    latitude,
    longitude,
    current: "weather_code,wind_speed_10m,temperature_2m",
    daily: "sunrise,sunset",
    forecast_days: "1",
    timezone: "auto",
    timeformat: "unixtime",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal });
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const data = await res.json();
  const code = data?.current?.weather_code;
  if (typeof code !== "number") throw new Error("weather: unexpected response");

  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const sec = (v: unknown) => (typeof v === "number" ? v * 1000 : undefined);
  const value: Conditions = {
    ...weatherFromCode(code),
    windKmh: num(data.current.wind_speed_10m) ?? 0,
    temperatureC: num(data.current.temperature_2m),
    sunrise: sec(data.daily?.sunrise?.[0]),
    sunset: sec(data.daily?.sunset?.[0]),
    latitude: num(data.latitude) ?? lat,
  };
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), v: value }));
  } catch {
    /* fine */
  }
  return value;
};

/** Two names for one zone ("Asia/Calcutta", "Asia/Kolkata") compare equal. */
const canon = (z: string) => {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: z }).resolvedOptions().timeZone;
  } catch {
    return z;
  }
};

/** Names the geocoder knows a city by, where the IANA name has moved on. */
const CITY_ALIASES: Record<string, string> = {
  Calcutta: "Kolkata",
  Saigon: "Ho Chi Minh City",
  Katmandu: "Kathmandu",
  Rangoon: "Yangon",
  Kiev: "Kyiv",
};

/**
 * An approximate place from nothing but the browser's timezone, with no
 * permission prompt: "America/New_York" becomes New York.
 *
 * Only the city name from the timezone goes to the geocoder, which is the same
 * string for everyone in that zone, so nothing personal is sent. A zone is a
 * big area, so this is a regional guess, not "where you are". Names can
 * collide (a town called Calcutta exists in South Africa), so a match is only
 * accepted when the geocoder says it is in the same timezone; otherwise this
 * returns null and the caller shows no weather instead of the wrong place.
 */
export async function placeFromTimeZone(
  tz: string,
  signal?: AbortSignal
): Promise<Place | null> {
  if (tz === "UTC" || tz.startsWith("Etc/") || !tz.includes("/")) return null;

  const cacheKey = `seasonal-sky:place:${tz}`;
  try {
    const hit = sessionStorage.getItem(cacheKey);
    if (hit) return JSON.parse(hit) as Place;
  } catch {
    /* no storage: just look it up */
  }

  const last = tz.split("/").pop()!.replace(/_/g, " ");
  const q = new URLSearchParams({
    name: CITY_ALIASES[last] ?? last,
    count: "10",
    language: "en",
    format: "json",
  });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${q}`, {
    signal,
  });
  if (!res.ok) return null;
  const data = await res.json();
  const want = canon(tz);
  const match = (data?.results ?? []).find(
    (r: { timezone?: string }) => r.timezone && canon(r.timezone) === want
  );
  if (!match) return null;

  const place: Place = { lat: match.latitude, lon: match.longitude, name: match.name };
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(place));
  } catch {
    /* fine */
  }
  return place;
}
