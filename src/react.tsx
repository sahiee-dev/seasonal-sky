import { useEffect, useRef, useState } from "react";
import { mountSky, type Sky, type SkyOptions, type SkyState } from "./sky";

/**
 * React bindings. The sky lives outside React's tree (it's a fixed canvas on
 * `document.body`), so these just mount it once and keep its options in sync.
 *
 * Works with the Next.js App Router: it only touches the DOM inside an effect,
 * so server and client markup match. Mark the importing file `"use client"`.
 */

/** Options that can change while mounted. Everything else is read at mount. */
const LIVE_KEYS = [
  "season",
  "time",
  "weather",
  "intensity",
  "tone",
  "hemisphere",
  "zIndex",
] as const;

function liveKey(o: SkyOptions): string {
  const loc = typeof o.location === "object" ? `${o.location.lat},${o.location.lon}` : o.location;
  return JSON.stringify([LIVE_KEYS.map((k) => o[k]), loc]);
}

/** Mount the sky for as long as the component is. Returns what's on screen
 *  (null until the first paint of the sky). */
export function useSky(options: SkyOptions = {}): SkyState | null {
  const [state, setState] = useState<SkyState | null>(null);
  const opts = useRef(options);
  opts.current = options;
  const sky = useRef<Sky | null>(null);

  useEffect(() => {
    const s = mountSky({
      ...opts.current,
      onChange: (st) => {
        setState(st);
        opts.current.onChange?.(st);
      },
    });
    sky.current = s;
    return () => {
      s.destroy();
      sky.current = null;
    };
  }, []);

  const key = liveKey(options);
  useEffect(() => {
    const o = opts.current;
    sky.current?.set({
      season: o.season,
      time: o.time,
      weather: o.weather,
      intensity: o.intensity,
      tone: o.tone,
      hemisphere: o.hemisphere,
      location: o.location,
      zIndex: o.zIndex,
    });
  }, [key]);

  return state;
}

/** `<SeasonalSky />`: the sky as a component. Renders nothing itself. */
export function SeasonalSky(props: SkyOptions): null {
  useSky(props);
  return null;
}

export type { SkyOptions, SkyState };
