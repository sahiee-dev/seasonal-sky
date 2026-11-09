import { browserTimeZone } from "./time";
import { openMeteo, placeFromTimeZone } from "./weather";
import type { Conditions, LiveStatus, Source, WeatherProvider } from "./types";

/**
 * Live weather for the visitor, without making them wait or leaving the page
 * empty.
 *
 * "ask": the browser is asked for the visitor's location (that call is what
 * raises the permission prompt). While the prompt is open, and if it is
 * declined or dismissed, a city guessed from the timezone stands in, so there
 * is always weather on screen. If permission was already granted the location
 * is used silently.
 *
 * "silent": a granted location is used, but nothing is ever asked.
 * "timezone": the geolocation API is never touched.
 * `{ lat, lon }`: a fixed place, no permission involved.
 *
 * Coordinates live in this closure only: not in state, not in storage.
 */

export type LocationMode = "ask" | "silent" | "timezone" | { lat: number; lon: number };

export type LiveState = {
  status: LiveStatus;
  conditions: Conditions | null;
  source: Source;
  /** City name when the source is "timezone". */
  place: string | null;
  /** The visitor was asked for their location and didn't share it. */
  denied: boolean;
};

export const IDLE: LiveState = {
  status: "idle",
  conditions: null,
  source: null,
  place: null,
  denied: false,
};

/** Conditions change slowly and the API updates every 15 minutes. */
const REFRESH_MS = 30 * 60 * 1000;

export type LiveOptions = {
  location: LocationMode;
  provider?: WeatherProvider;
  onChange: (s: LiveState) => void;
};

export type LiveHandle = {
  /** Ask the browser for the exact location now (no-op unless it can help). */
  askPrecise(): void;
  stop(): void;
};

export function startLive({ location, provider = openMeteo, onChange }: LiveOptions): LiveHandle {
  let state = IDLE;
  let runId = 0;
  let stopped = false;
  let teardown: (() => void) | null = null;

  const emit = (s: LiveState) => {
    state = s;
    if (!stopped) onChange(s);
  };

  /** One attempt at finding weather. Starting a new one cancels the last. */
  function run(mode: "ask" | "silent" | "timezone" | "fixed") {
    teardown?.();
    const id = ++runId;
    const ctl = new AbortController();
    let timer: number | undefined;
    let preciseDone = false;
    let denied = false;
    const live = () => !stopped && id === runId;

    teardown = () => {
      ctl.abort();
      if (timer !== undefined) window.clearInterval(timer);
    };

    const load = (lat: number, lon: number, rest: () => Partial<LiveState>) =>
      provider(lat, lon, ctl.signal)
        .then((conditions) => {
          if (!live()) return;
          const r = rest();
          // A slow regional answer must never overwrite an exact one.
          if (r.source === "timezone" && preciseDone) return;
          emit({ ...IDLE, status: "ready", conditions, ...r });
        })
        .catch(() => {
          // A failed refresh keeps showing the last good reading.
          if (live() && !ctl.signal.aborted)
            emit(state.conditions ? state : { ...state, status: "error" });
        });

    const track = (lat: number, lon: number, rest: () => Partial<LiveState>) => {
      if (timer !== undefined) window.clearInterval(timer);
      load(lat, lon, rest);
      timer = window.setInterval(() => load(lat, lon, rest), REFRESH_MS);
    };

    const byTimeZone = async () => {
      const tz = browserTimeZone();
      const place = tz ? await placeFromTimeZone(tz, ctl.signal).catch(() => null) : null;
      if (!live() || preciseDone) return;
      if (!place) {
        emit({ ...IDLE, status: "unavailable", denied });
        return;
      }
      track(place.lat, place.lon, () => ({
        source: "timezone",
        place: place.name,
        denied,
      }));
    };

    const byLocation = () =>
      new Promise<boolean>((resolve) => {
        if (typeof navigator === "undefined" || !("geolocation" in navigator)) return resolve(false);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (!live()) return resolve(true);
            preciseDone = true;
            track(pos.coords.latitude, pos.coords.longitude, () => ({ source: "precise" }));
            resolve(true);
          },
          () => resolve(false),
          { timeout: 30_000, maximumAge: REFRESH_MS }
        );
      });

    (async () => {
      // Keep what's on screen while a retry is under way.
      if (!state.conditions) emit({ ...IDLE, status: "locating" });

      if (mode === "fixed" && typeof location === "object") {
        track(location.lat, location.lon, () => ({ source: "fixed" }));
        return;
      }
      if (mode === "timezone") {
        await byTimeZone();
        return;
      }

      let granted = false;
      try {
        const p = await navigator.permissions?.query({ name: "geolocation" });
        granted = p?.state === "granted";
      } catch {
        /* Permissions API missing: treat as not granted */
      }
      if (!live()) return;

      if (granted) {
        if (!(await byLocation()) && live()) await byTimeZone();
        return;
      }
      if (mode === "silent") {
        await byTimeZone();
        return;
      }

      // Ask, but don't make the page wait on the answer: regional weather
      // goes up now and is replaced if the location arrives.
      const regional = byTimeZone();
      const ok = await byLocation();
      if (!live() || ok) return;
      denied = true;
      await regional;
      if (live() && state.source === "timezone") emit({ ...state, denied: true });
    })();
  }

  const base = typeof location === "object" ? "fixed" : location === "ask" ? "silent" : location;
  run(base);

  return {
    askPrecise() {
      if (typeof location === "object" || location === "timezone") return;
      if (state.source === "precise") return;
      run("ask");
    },
    stop() {
      stopped = true;
      runId++;
      teardown?.();
      teardown = null;
    },
  };
}
