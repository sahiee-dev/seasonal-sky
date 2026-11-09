import { HazeLayer, injectStyles } from "./haze";
import { startLive, type LiveHandle, type LiveState, type LocationMode, IDLE } from "./live";
import { buildRecipe } from "./recipe";
import { SkyRenderer } from "./renderer";
import {
  browserTimeZone,
  hemisphereFromLatitude,
  hemisphereFromTimeZone,
  phaseFromSun,
  phaseOf,
  seasonOf,
} from "./time";
import { detectTone, watchTone } from "./tone";
import type {
  Hemisphere,
  LiveStatus,
  Phase,
  Recipe,
  Season,
  Source,
  Tone,
  Weather,
  WeatherProvider,
} from "./types";

export type SkyOptions = {
  /** Where the canvas goes. Default `document.body`. The sky is always
   *  `position: fixed` and full-viewport; this only decides where it lives in
   *  the DOM. */
  container?: HTMLElement;

  /** "auto" follows the calendar (and the hemisphere). */
  season?: Season | "auto";
  /** "auto" follows the sun when live weather knows it, else the clock. */
  time?: Phase | "auto";
  /** "live" asks a weather service; "none" is seasons only; or force a look. */
  weather?: Weather | "live" | "none";
  /** How hard a forced look falls, about 0.3 to 1.7. Default 1. */
  intensity?: number;
  /** "auto" reads the page background. Set it if you know better. */
  tone?: Tone | "auto";
  /** "auto" uses the latitude when known, else a guess from the timezone. */
  hemisphere?: Hemisphere | "auto";

  /** How live weather is located. Default "ask". See `LocationMode`. */
  location?: LocationMode;
  /** With location "ask", wait this many ms, or for this promise, before the
   *  browser's permission prompt appears. Handy to hold it back until an intro
   *  animation is done. Until then a timezone estimate is shown. Default 0. */
  askAfter?: number | Promise<unknown>;
  /** Raise the prompt at most once per tab session. Default true. */
  askOnce?: boolean;
  /** Use another weather service than Open-Meteo. */
  provider?: WeatherProvider;

  /** Pointer and scroll push the particles. Default true. */
  interactive?: boolean;
  /** Clicks on elements matching this don't make a gust. Default: links,
   *  buttons, form controls. */
  ignoreClicks?: string;
  /** z-index of the canvas; the fog layer sits one below. Default 50. */
  zIndex?: number;
  /** Fixed density multiplier, or "auto" to back off on slow machines. */
  quality?: number | "auto";
  /** Draw nothing for visitors who ask for reduced motion. Default true. */
  respectReducedMotion?: boolean;
  /** CSP nonce for the one `<style>` tag this adds. */
  nonce?: string;

  /** Called whenever what's on screen changes. */
  onChange?: (state: SkyState) => void;
};

export type SkyState = {
  season: Season;
  phase: Phase;
  weather: Weather;
  intensity: number;
  tone: Tone;
  hemisphere: Hemisphere;
  /** Where the weather came from: the exact location, a city guessed from the
   *  timezone, fixed coordinates, or nowhere (a forced look, or none). */
  source: Source;
  /** The guessed city, when `source` is "timezone". */
  place: string | null;
  status: LiveStatus;
  /** The visitor was asked for their location and said no. */
  denied: boolean;
  windKmh: number;
  temperatureC: number | null;
  recipe: Recipe;
};

const ASKED_KEY = "seasonal-sky:asked";
/** Re-check the clock this often, so a tab left open crosses dawn into day. */
const TICK_MS = 5 * 60 * 1000;
/** Options `set()` can change after mounting. */
type Settable = Pick<
  SkyOptions,
  | "season"
  | "time"
  | "weather"
  | "intensity"
  | "tone"
  | "hemisphere"
  | "location"
  | "provider"
  | "zIndex"
  | "onChange"
>;

export class Sky {
  private o: SkyOptions;
  private canvas: HTMLCanvasElement | null = null;
  private haze: HazeLayer | null = null;
  private renderer: SkyRenderer | null = null;
  private live: LiveHandle | null = null;
  private liveState: LiveState = IDLE;
  private autoTone: Tone = "light";
  private state: SkyState | null = null;
  private stateKey = "";
  private cleanups: (() => void)[] = [];
  private dead = false;

  constructor(options: SkyOptions = {}) {
    this.o = options;
    if (typeof window === "undefined") return; // server render: nothing to draw
    if (!options.container && document.readyState === "loading") {
      const go = () => this.init();
      document.addEventListener("DOMContentLoaded", go, { once: true });
      this.cleanups.push(() => document.removeEventListener("DOMContentLoaded", go));
    } else {
      this.init();
    }
  }

  /** What is on screen right now; null on the server or before the page is ready. */
  getState(): SkyState | null {
    return this.state;
  }

  /** Change options after mounting. `container`, `interactive`, `quality`,
   *  `ignoreClicks` and the like are fixed at mount; remount to change them. */
  set(patch: Settable) {
    if (this.dead) return;
    const was = this.o;
    this.o = { ...was, ...patch };
    if (!this.renderer) return; // not mounted yet: init() will read the new options
    const liveWas = this.wantsLive(was);
    const liveNow = this.wantsLive(this.o);
    if (liveNow && (!liveWas || patch.location !== undefined || patch.provider !== undefined)) {
      this.startLiveWeather();
    } else if (!liveNow && liveWas) {
      this.stopLiveWeather();
    }
    if (patch.zIndex !== undefined) this.applyZ();
    this.update();
  }

  /** Ask the browser for the exact location now (shows the permission prompt
   *  if it hasn't been answered). Works with location "ask" or "silent". */
  requestLocation() {
    this.live?.askPrecise();
  }

  /** Debug view of the live particles. */
  snapshot() {
    return this.renderer?.snapshot() ?? null;
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.cleanups.forEach((f) => f());
    this.cleanups = [];
    this.stopLiveWeather();
    this.renderer?.destroy();
    this.canvas?.remove();
    this.haze?.el.remove();
    this.renderer = null;
    this.canvas = null;
    this.haze = null;
    this.state = null;
  }

  // ---- internals -----------------------------------------------------------

  private wantsLive(o: SkyOptions) {
    return (o.weather ?? "live") === "live";
  }

  private init() {
    if (this.dead) return;
    const host = this.o.container ?? document.body;
    injectStyles(this.o.nonce);

    this.haze = new HazeLayer(0);
    this.canvas = document.createElement("canvas");
    this.canvas.className = "ss-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.applyZ();
    host.append(this.haze.el, this.canvas);

    this.renderer = new SkyRenderer(this.canvas, {
      interactive: this.o.interactive,
      ignoreClicks: this.o.ignoreClicks,
      quality: this.o.quality,
      respectReducedMotion: this.o.respectReducedMotion,
    });

    this.autoTone = detectTone();
    this.cleanups.push(
      watchTone(() => {
        const t = detectTone();
        if (t !== this.autoTone) {
          this.autoTone = t;
          this.update();
        }
      })
    );
    const tick = window.setInterval(() => this.update(), TICK_MS);
    this.cleanups.push(() => window.clearInterval(tick));

    if (this.wantsLive(this.o)) {
      this.startLiveWeather();
      this.scheduleAsk();
    }
    this.update();
  }

  private applyZ() {
    const z = this.o.zIndex ?? 50;
    if (this.canvas) this.canvas.style.zIndex = String(z);
    if (this.haze) this.haze.el.style.zIndex = String(z - 1);
  }

  private startLiveWeather() {
    this.stopLiveWeather();
    this.liveState = IDLE;
    this.live = startLive({
      location: this.o.location ?? "ask",
      provider: this.o.provider,
      onChange: (s) => {
        this.liveState = s;
        this.update();
      },
    });
  }

  private stopLiveWeather() {
    this.live?.stop();
    this.live = null;
    this.liveState = IDLE;
  }

  /** The permission prompt, at most once a session, after `askAfter`. */
  private scheduleAsk() {
    if ((this.o.location ?? "ask") !== "ask") return;
    if (this.o.askOnce ?? true) {
      let asked = true; // if storage is unavailable we can't remember, so don't ask
      try {
        asked = sessionStorage.getItem(ASKED_KEY) === "1";
      } catch {
        /* leave asked = true */
      }
      if (asked) return;
    }
    const go = () => {
      if (this.dead) return;
      try {
        sessionStorage.setItem(ASKED_KEY, "1");
      } catch {
        /* checked above */
      }
      this.live?.askPrecise();
    };
    const after = this.o.askAfter ?? 0;
    if (typeof after === "number") {
      const id = window.setTimeout(go, after);
      this.cleanups.push(() => window.clearTimeout(id));
    } else {
      Promise.resolve(after).then(go, go);
    }
  }

  private update() {
    if (this.dead || !this.renderer || !this.haze) return;
    const o = this.o;
    const now = new Date();
    const c = this.liveState.conditions;
    const live = this.wantsLive(o);

    const hemisphere: Hemisphere =
      o.hemisphere && o.hemisphere !== "auto"
        ? o.hemisphere
        : c?.latitude !== undefined
          ? hemisphereFromLatitude(c.latitude)
          : hemisphereFromTimeZone(browserTimeZone());
    const season = o.season && o.season !== "auto" ? o.season : seasonOf(now, hemisphere);
    const phase: Phase =
      o.time && o.time !== "auto"
        ? o.time
        : live && c?.sunrise !== undefined && c.sunset !== undefined
          ? phaseFromSun(now.getTime(), c.sunrise, c.sunset)
          : phaseOf(now);
    const tone = o.tone && o.tone !== "auto" ? o.tone : this.autoTone;

    let weather: Weather = "clear";
    let intensity = 1;
    let freezing = false;
    let windKmh = 0;
    let temperatureC: number | undefined;
    if (live) {
      if (c) {
        ({ weather, intensity, freezing, windKmh, temperatureC } = c);
      }
    } else if (o.weather && o.weather !== "none" && o.weather !== "live") {
      weather = o.weather;
      intensity = o.intensity ?? 1;
    }

    const recipe = buildRecipe({
      season,
      phase,
      weather,
      tone,
      intensity,
      freezing,
      temperatureC,
      windKmh,
    });
    this.renderer.setRecipe(recipe);
    this.haze.update(recipe.haze, tone);

    const state: SkyState = {
      season,
      phase,
      weather,
      intensity,
      tone,
      hemisphere,
      source: live ? this.liveState.source : null,
      place: live ? this.liveState.place : null,
      status: live ? this.liveState.status : "idle",
      denied: live ? this.liveState.denied : false,
      windKmh,
      temperatureC: temperatureC ?? null,
      recipe,
    };
    const key = JSON.stringify(state);
    if (key === this.stateKey) return;
    this.stateKey = key;
    this.state = state;
    this.o.onChange?.(state);
  }
}

/** Put the sky on the page. Returns a handle to adjust or remove it. */
export function mountSky(options: SkyOptions = {}): Sky {
  return new Sky(options);
}
