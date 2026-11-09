import { sprite } from "./sprites";
import type { Kind, Layer, Recipe } from "./types";

/**
 * The renderer. One canvas, one loop, every kind of particle.
 *
 * Everything shares a single wind (steady plus gusts), so a storm bends rain,
 * leaves and petals together instead of three layers doing three things. The
 * pointer is wind too: moving it through the sky pushes leaves and flakes
 * aside, a click sends a shockwave out, rain stops at an invisible umbrella
 * around the cursor, and fireflies are curious about it.
 *
 * When the recipe changes, outgoing layers fade out while incoming ones fade
 * in, so rain easing into snow is a transition and not a cut.
 *
 * If the machine can't keep up, the particle count steps down by itself.
 * With prefers-reduced-motion nothing is drawn.
 */

type Motion = "fall" | "rain" | "firefly";

type P = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  ph: number;
  sw: number;
  swF: number;
  a: number;
  speed: number;
  kind: Kind;
  spr: HTMLCanvasElement | null;
};

type Pool = {
  layer: Layer;
  key: string;
  motion: Motion;
  ps: P[];
  /** 0 to 1, multiplies every particle's alpha. */
  fade: number;
  /** Where `fade` is heading: 1 for live layers, 0 for ones on their way out. */
  target: 0 | 1;
};
type Gust = { x: number; y: number; t0: number };
type Ripple = { x: number; y: number; t0: number };
type Strike = { t0: number; bolt: [number, number][] };

export type RendererOptions = {
  /** Listen for the pointer and scroll (push, shockwave, umbrella). Default true. */
  interactive?: boolean;
  /** Clicks on elements matching this selector don't make a gust. */
  ignoreClicks?: string;
  /** A fixed density multiplier, or "auto" to start at 1 and step down if
   *  frames run slow. Default "auto". */
  quality?: number | "auto";
  /** Draw nothing when the visitor prefers reduced motion. Default true. */
  respectReducedMotion?: boolean;
};

const REF_AREA = 1440 * 900;
const DEFAULT_IGNORE =
  "a, button, input, textarea, select, summary, label, [role='button']";
/** Seconds for a layer to fade in or out. */
const FADE_S = 1.2;
/** Frame time (ms) above which the renderer decides it is struggling. */
const SLOW_FRAME_MS = 40;
const MIN_QUALITY = 0.4;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const motionOf = (kinds: Kind[]): Motion =>
  kinds[0] === "rain" || kinds[0] === "sleet"
    ? "rain"
    : kinds[0] === "firefly"
      ? "firefly"
      : "fall";

export class SkyRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private scale = 1;
  private quality = 1;
  private readonly autoQuality: boolean;
  private slowFrames = 0;
  private frameMs = 16.7;
  private recipe: Recipe | null = null;
  private recipeKey = "";
  private pools = new Map<string, Pool>();
  private leaving: Pool[] = [];
  private raf = 0;
  private last = 0;
  private wind = 0;
  private dead = false;
  private readonly reduced: boolean;
  private readonly finePointer: boolean;
  private readonly ignore: string;
  private cleanup: (() => void)[] = [];

  // pointer
  private px = -9999;
  private py = -9999;
  private pvx = 0;
  private pvy = 0;
  private lastX = 0;
  private lastY = 0;
  private lastMove = 0;
  private gusts: Gust[] = [];
  private ripples: Ripple[] = [];

  // scroll
  private lastScroll = 0;
  private scrollPush = 0;

  // rainbow
  private rainbowImg: HTMLCanvasElement | null = null;
  private rainbowA = 0;

  // lightning
  private nextStrike = 0;
  private strike: Strike | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    opts: RendererOptions = {}
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.ignore = opts.ignoreClicks ?? DEFAULT_IGNORE;
    this.autoQuality = opts.quality === undefined || opts.quality === "auto";
    if (typeof opts.quality === "number") this.quality = clamp(opts.quality, 0.1, 2);
    this.reduced =
      (opts.respectReducedMotion ?? true) &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.finePointer = window.matchMedia("(pointer: fine)").matches;
    if (this.reduced) return;

    this.resize();
    this.lastScroll = window.scrollY;
    this.on(window, "resize", this.resize);
    if (opts.interactive ?? true) {
      this.on(window, "pointermove", this.onMove as EventListener, { passive: true });
      this.on(window, "pointerdown", this.onDown as EventListener, { passive: true });
      this.on(window, "scroll", this.onScroll, { passive: true });
      this.on(document, "mouseout", this.onOut as EventListener);
    }
    this.on(document, "visibilitychange", this.onVisibility);
    this.start();
  }

  /** Swap what the sky looks like. Cheap to call with an unchanged recipe. */
  setRecipe(recipe: Recipe) {
    if (this.reduced || this.dead) return;
    const key = JSON.stringify(recipe);
    if (key === this.recipeKey) return;
    this.recipeKey = key;
    const wasStorm = this.recipe?.lightning ?? false;
    this.recipe = recipe;

    const keep = new Set<string>();
    for (const layer of recipe.layers) {
      keep.add(layer.id);
      const lk = JSON.stringify(layer);
      const old = this.pools.get(layer.id);
      if (old && old.key === lk) continue;
      if (old) this.retire(old);
      const pool: Pool = {
        layer,
        key: lk,
        motion: motionOf(layer.kinds),
        ps: [],
        fade: 0,
        target: 1,
      };
      this.pools.set(layer.id, pool);
      this.fill(pool, true);
    }
    for (const [id, pool] of [...this.pools]) {
      if (keep.has(id)) continue;
      this.retire(pool);
      this.pools.delete(id);
    }

    if (recipe.lightning && !wasStorm) this.nextStrike = performance.now() + rand(1500, 4000);
    if (!recipe.lightning) this.strike = null;
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.pools.clear();
    this.leaving = [];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Read-only view of what's alive; for tests, demos and debugging. */
  snapshot() {
    return {
      wind: this.wind,
      rainbow: this.rainbowA,
      quality: this.quality,
      lightning: this.strike !== null,
      pools: [...this.pools.values()].map((p) => ({
        id: p.layer.id,
        motion: p.motion,
        kinds: p.layer.kinds,
        count: p.ps.length,
        fade: p.fade,
        particles: p.ps,
      })),
      leaving: this.leaving.length,
    };
  }

  // ---- lifecycle -----------------------------------------------------------

  private on(
    t: Window | Document,
    type: string,
    fn: EventListenerOrEventListenerObject,
    o?: AddEventListenerOptions
  ) {
    t.addEventListener(type, fn, o);
    this.cleanup.push(() => t.removeEventListener(type, fn, o));
  }

  private start() {
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private onVisibility = () => {
    if (document.hidden) cancelAnimationFrame(this.raf);
    else if (!this.dead) this.start();
  };

  private resize = () => {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.scale = clamp((this.w * this.h) / REF_AREA, 0.45, 1.25);
    this.rainbowImg = null;
    this.refillAll();
  };

  private refillAll() {
    for (const pool of this.pools.values()) this.fill(pool, false);
    for (const pool of this.leaving) this.fill(pool, false);
  }

  /** Slow machines get fewer particles instead of a stuttering page. It only
   *  steps down, never back up, so it can't oscillate. */
  private watchFrameRate(ms: number) {
    if (!this.autoQuality || ms > 120) return; // a long gap is a hidden tab, not slowness
    this.frameMs += (ms - this.frameMs) * 0.05;
    if (this.frameMs <= SLOW_FRAME_MS) {
      this.slowFrames = 0;
      return;
    }
    if (++this.slowFrames < 120 || this.quality <= MIN_QUALITY) return;
    this.quality = Math.max(MIN_QUALITY, this.quality * 0.75);
    this.slowFrames = 0;
    this.frameMs = 16.7;
    this.refillAll();
  }

  // ---- particles -----------------------------------------------------------

  private retire(pool: Pool) {
    pool.target = 0;
    this.leaving.push(pool);
  }

  /** Grow or trim a pool to the count this viewport wants. */
  private fill(pool: Pool, anywhere: boolean) {
    const want = Math.round(pool.layer.count * this.scale * this.quality);
    while (pool.ps.length < want) {
      const p = {} as P;
      this.seed(pool, p, anywhere);
      pool.ps.push(p);
    }
    pool.ps.length = Math.min(pool.ps.length, want);
  }

  private seed(pool: Pool, p: P, anywhere: boolean) {
    const L = pool.layer;
    p.kind = pick(L.kinds);
    p.size = rand(L.size[0], L.size[1]);
    p.speed = rand(L.speed[0], L.speed[1]);
    p.sw = rand(L.sway[0], L.sway[1]);
    p.swF = rand(0.6, pool.motion === "firefly" ? 2.2 : 1.8);
    p.ph = rand(0, Math.PI * 2);
    p.vr = rand(L.spin[0], L.spin[1]);
    p.a = rand(L.alpha[0], L.alpha[1]);
    p.rot = pool.motion === "fall" ? rand(0, Math.PI * 2) : 0;
    p.vx = 0;
    p.vy = pool.motion === "fall" || pool.motion === "rain" ? p.speed : 0;

    if (pool.motion === "rain") {
      // Rain leans with the wind, so spawn upwind to still cover the whole screen.
      const lean = Math.abs(this.wind) * (1.8 / 20) * this.h;
      p.x = rand(-lean - 20, this.w + 20);
      p.y = anywhere ? rand(-p.size, this.h) : -p.size - rand(0, 50);
      p.spr = null;
      return;
    }
    if (pool.motion === "firefly") {
      p.x = rand(0, this.w);
      p.y = rand(this.h * 0.15, this.h);
      p.vx = rand(-0.2, 0.2);
      p.vy = rand(-0.2, 0.2);
    } else {
      p.x = rand(-0.1 * this.w, 1.1 * this.w);
      p.y = anywhere ? rand(-0.05 * this.h, this.h) : -p.size - rand(0, 60);
    }
    p.spr = sprite(p.kind as Exclude<Kind, "rain" | "sleet">, pick(L.colors), p.size, this.dpr);
  }

  // ---- input ---------------------------------------------------------------

  private onMove = (e: PointerEvent) => {
    const now = performance.now();
    const dt = Math.max((now - this.lastMove) / 16.67, 0.5);
    if (this.px > -1000 && now - this.lastMove < 200) {
      this.pvx = this.pvx * 0.5 + ((e.clientX - this.lastX) / dt) * 0.5;
      this.pvy = this.pvy * 0.5 + ((e.clientY - this.lastY) / dt) * 0.5;
    }
    this.px = this.lastX = e.clientX;
    this.py = this.lastY = e.clientY;
    this.lastMove = now;
  };

  private onOut = (e: MouseEvent) => {
    if (!e.relatedTarget) {
      this.px = this.py = -9999;
      this.pvx = this.pvy = 0;
    }
  };

  private onDown = (e: PointerEvent) => {
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest(this.ignore)) return;
    this.gusts.push({ x: e.clientX, y: e.clientY, t0: performance.now() });
    if (this.gusts.length > 4) this.gusts.shift();
  };

  private onScroll = () => {
    const y = window.scrollY;
    this.scrollPush = clamp(this.scrollPush + (y - this.lastScroll) * 0.08, -25, 25);
    this.lastScroll = y;
  };

  // ---- frame ---------------------------------------------------------------

  private frame = (now: number) => {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.frame);
    const r = this.recipe;
    const { ctx, dpr } = this;
    this.watchFrameRate(now - this.last);
    // Normalised to 60fps and clamped so a backgrounded tab doesn't leap.
    const k = Math.min((now - this.last) / 16.67, 3);
    this.last = now;
    const t = now / 1000;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!r) return;

    // One wind for everything: steady, plus slow overlapping gusts.
    const gustSwing =
      Math.sin(t * 0.7) * 0.6 + Math.sin(t * 1.9 + 1.3) * 0.3 + Math.sin(t * 0.23 + 4) * 0.5;
    this.wind = r.wind + r.gust * gustSwing;

    // Pointer speed fades when the pointer stops.
    const decay = Math.pow(0.88, k);
    this.pvx *= decay;
    this.pvy *= decay;
    const pointerSpeed = Math.hypot(this.pvx, this.pvy);
    this.scrollPush *= Math.pow(0.9, k);

    this.drawRainbow(k);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.gusts = this.gusts.filter((g) => now - g.t0 < 600);

    const step = k / (FADE_S * 60);
    for (const pool of [...this.pools.values(), ...this.leaving]) {
      pool.fade = clamp(pool.fade + (pool.target ? step : -step), 0, 1);
      if (pool.motion === "rain") this.stepRain(pool, k, now);
      else if (pool.motion === "firefly") this.stepFireflies(pool, k, t, now);
      else this.stepFall(pool, k, t, now, pointerSpeed);
    }
    if (this.leaving.length) this.leaving = this.leaving.filter((p) => p.fade > 0);

    this.drawRipples(now, r);
    ctx.globalAlpha = 1;
    this.drawLightning(now, r);
  };

  private stepFall(pool: Pool, k: number, t: number, now: number, pointerSpeed: number) {
    const { ctx, w, h } = this;
    const wr = pool.layer.wind;
    const R = 130;
    const pushing = pointerSpeed > 0.5 && this.px > -1000;

    for (const p of pool.ps) {
      // Drift toward the wind; fall toward terminal speed.
      p.vx += (this.wind * wr - p.vx) * Math.min(1, 0.05 * k);
      p.vy += (p.speed - p.vy) * Math.min(1, 0.06 * k);

      if (pushing) {
        const dx = p.x - this.px;
        const dy = p.y - this.py;
        const d2 = dx * dx + dy * dy;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) || 1;
          const f = (1 - d / R) ** 2 * k;
          p.vx += (this.pvx * 0.16 + (dx / d) * 0.9) * f;
          p.vy += (this.pvy * 0.16 + (dy / d) * 0.9) * f;
        }
      }

      // A click is a ring of wind spreading out from where it landed.
      for (const g of this.gusts) {
        const age = (now - g.t0) / 1000;
        const ring = 40 + age * 620;
        const dx = p.x - g.x;
        const dy = p.y - g.y;
        const d = Math.hypot(dx, dy) || 1;
        const off = Math.abs(d - ring);
        if (off < 110) {
          const f = (1 - off / 110) * (1 - age / 0.6) * 1.7 * k;
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
        }
      }

      p.vx = clamp(p.vx, -16, 16);
      p.vy = clamp(p.vy, -10, 14);

      p.x += p.vx * k + Math.sin(t * p.swF + p.ph) * p.sw * 0.6 * k;
      p.y += p.vy * k - this.scrollPush * 0.12 * (0.5 + p.size / 40) * k;
      p.rot += ((p.vr + p.vx * 0.04) * k * Math.PI) / 180;

      const m = p.size + 20;
      if (p.y > h + p.size) this.seed(pool, p, false);
      else if (p.y < -h * 0.6) p.y = h + p.size * 0.5;
      if (p.x > w + m) p.x = -m;
      else if (p.x < -m) p.x = w + m;

      if (!p.spr) continue;
      // Flakes driven fast by wind smear along their path: that is what turns
      // a snowfall into a blizzard.
      const sp = Math.hypot(p.vx, p.vy);
      let rot = p.rot;
      let dw = p.size;
      let dh = p.size;
      if (p.kind === "flake" && sp > 3) {
        rot = Math.atan2(p.vy, p.vx);
        dw = p.size * Math.min(1 + (sp - 3) * 0.5, 4);
        dh = p.size * 0.8;
      }
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      ctx.globalAlpha = p.a * pool.fade;
      ctx.setTransform(this.dpr * c, this.dpr * s, -this.dpr * s, this.dpr * c, p.x * this.dpr, p.y * this.dpr);
      ctx.drawImage(p.spr, -dw / 2, -dh / 2, dw, dh);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private stepRain(pool: Pool, k: number, now: number) {
    const { ctx, w, h } = this;
    const color = `rgb(${rgbOf(pool.layer.colors[0] ?? "#466996")})`;
    const umbrella = this.finePointer && this.px > -1000;
    const U = 30;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.lineCap = "round";

    for (const p of pool.ps) {
      // Faster drops lean further; the lean follows the shared wind.
      const targetVx = this.wind * 1.8 * (p.speed / 20);
      p.vx += (targetVx - p.vx) * Math.min(1, 0.15 * k);
      p.y += p.speed * k;
      p.x += p.vx * k;

      if (umbrella && pool.target) {
        const dx = p.x - this.px;
        const dy = p.y - this.py;
        if (dx * dx + dy * dy < U * U) {
          if (this.ripples.length < 60) this.ripples.push({ x: p.x, y: p.y, t0: now });
          this.seed(pool, p, false);
          continue;
        }
      }

      if (p.y - p.size > h || p.x - p.size > w + 80 || p.x + p.size < -80) {
        // A layer on its way out stops respawning, so it thins as it fades.
        if (pool.target) this.seed(pool, p, false);
        else p.y = h * 4;
        continue;
      }

      const m = Math.hypot(p.vx, p.speed) || 1;
      ctx.globalAlpha = p.a * pool.fade;
      ctx.beginPath();
      ctx.moveTo(p.x - (p.vx / m) * p.size, p.y - (p.speed / m) * p.size);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }

  private stepFireflies(pool: Pool, k: number, t: number, now: number) {
    const { ctx, w, h } = this;
    const near = this.px > -1000;
    for (const p of pool.ps) {
      p.vx += rand(-0.02, 0.02) * k;
      p.vy += rand(-0.02, 0.02) * k;

      // Curious about the cursor: drift toward it, but never quite land on it.
      if (near) {
        const dx = this.px - p.x;
        const dy = this.py - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 240 && d > 60) {
          p.vx += (dx / d) * 0.012 * k;
          p.vy += (dy / d) * 0.012 * k;
        }
      }
      for (const g of this.gusts) {
        const age = (now - g.t0) / 1000;
        const dx = p.x - g.x;
        const dy = p.y - g.y;
        const d = Math.hypot(dx, dy) || 1;
        const off = Math.abs(d - (40 + age * 620));
        if (off < 110) {
          const f = (1 - off / 110) * (1 - age / 0.6) * 1.2 * k;
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
        }
      }

      const cap = p.speed * 2.2;
      p.vx = clamp(p.vx * Math.pow(0.985, k), -cap, cap);
      p.vy = clamp(p.vy * Math.pow(0.985, k), -cap, cap);
      p.x += p.vx * k;
      p.y += p.vy * k;
      if (p.x < -20) p.x = w + 20;
      else if (p.x > w + 20) p.x = -20;
      if (p.y < -20) p.y = h + 20;
      else if (p.y > h + 20) p.y = -20;

      if (!p.spr) continue;
      const b = Math.sin(t * p.swF + p.ph);
      const glow = b > 0 ? b ** 3 : 0;
      ctx.globalAlpha = p.a * (0.18 + 0.82 * glow) * pool.fade;
      ctx.drawImage(p.spr, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }

  private drawRipples(now: number, r: Recipe) {
    if (!this.ripples.length) return;
    const { ctx } = this;
    ctx.strokeStyle = r.tone === "light" ? "rgb(70,105,150)" : "rgb(200,220,245)";
    ctx.lineWidth = 1;
    this.ripples = this.ripples.filter((p) => now - p.t0 < 320);
    for (const p of this.ripples) {
      const e = (now - p.t0) / 320;
      const rx = 2 + 11 * e;
      ctx.globalAlpha = (1 - e) * 0.5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rx, rx * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /**
   * A rainbow, drawn the way a real one looks rather than as seven stripes:
   *
   * - one smooth sweep of hue (red outside, violet inside) with no hard
   *   bands, brightest in the middle of the arc's thickness and fading to
   *   nothing at both edges, because a real bow is diffuse light;
   * - thin, and a partial arc that rises from the lower left and runs off the
   *   right edge, instead of a screen-spanning semicircle;
   * - fading out toward the bottom, where it dissolves into the rain curtain;
   * - a much fainter second bow outside it with the colours reversed;
   * - added to the scene as light ("screen") on dark pages, and as a soft
   *   tint ("multiply") on light ones, where light can't be added to white;
   * - formed slowly as the recipe's `rainbow` strength rises, and gone slowly.
   *
   * The bow is rendered once per size and cached.
   */
  private drawRainbow(k: number) {
    const target = this.recipe?.rainbow ?? 0;
    this.rainbowA += (target - this.rainbowA) * Math.min(1, 0.006 * k);
    if (this.rainbowA < 0.005) return;

    if (!this.rainbowImg) {
      const { w, h, dpr } = this;
      const c = document.createElement("canvas");
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      const g = c.getContext("2d")!;

      const R = Math.min(Math.max(h * 0.95, w * 0.3), w * 0.5) * dpr;
      const cx = w * 0.6 * dpr;
      const cy = h * dpr + R * 0.6;

      /* One bow: a radial gradient whose hue sweeps across its thickness and
         whose opacity follows a smooth bell, zero at both edges. */
      const bow = (radius: number, thick: number, strength: number, reversed: boolean) => {
        const inner = radius * (1 - thick);
        const grad = g.createRadialGradient(cx, cy, inner, cx, cy, radius);
        const N = 28;
        for (let i = 0; i <= N; i++) {
          const t = i / N; // 0 at the inner edge, 1 at the outer
          const hue = (reversed ? t : 1 - t) * 275; // outer red -> inner violet
          const bell = Math.sin(Math.PI * t) ** 1.5;
          grad.addColorStop(t, `hsla(${hue}, 90%, 58%, ${(bell * strength).toFixed(3)})`);
        }
        g.fillStyle = grad;
        g.fillRect(0, 0, c.width, c.height);
      };
      bow(R, 0.07, 1, false);
      bow(R * 1.27, 0.085, 0.14, true);

      // Dissolve toward the bottom edge.
      g.globalCompositeOperation = "destination-in";
      const fade = g.createLinearGradient(0, h * dpr * 0.45, 0, h * dpr);
      fade.addColorStop(0, "rgba(0,0,0,1)");
      fade.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = fade;
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = "source-over";

      this.rainbowImg = c;
    }

    const shimmer = 0.94 + 0.06 * Math.sin(performance.now() / 2600);
    const { ctx } = this;
    const light = this.recipe?.tone === "light";
    ctx.globalCompositeOperation = light ? "multiply" : "screen";
    // Added light on a dark page needs a little more strength to read than a
    // tint on a light one.
    ctx.globalAlpha = Math.min(1, this.rainbowA) * (light ? 0.5 : 0.7) * shimmer;
    ctx.drawImage(this.rainbowImg, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }

  /** One soft pulse and a thin bolt, every 6 to 16 seconds. Deliberately a
   *  single low-contrast event and never a flicker: well inside what is safe
   *  for photosensitive viewers. On a light page a bright flash is invisible,
   *  so there it is a brief cool-grey dimming instead. */
  private drawLightning(now: number, r: Recipe) {
    if (r.lightning && !this.strike && now >= this.nextStrike) {
      const bolt: [number, number][] = [];
      let x = rand(this.w * 0.15, this.w * 0.85);
      let y = 0;
      const maxY = rand(this.h * 0.5, this.h * 0.85);
      bolt.push([x, y]);
      while (y < maxY) {
        y += rand(22, 48);
        x += rand(-34, 34);
        bolt.push([x, y]);
      }
      this.strike = { t0: now, bolt };
      this.nextStrike = now + rand(6000, 16000);
    }
    const s = this.strike;
    if (!s) return;
    const e = now - s.t0;
    if (e > 1000) {
      this.strike = null;
      return;
    }
    const { ctx, w, h } = this;
    const dark = r.tone === "dark";
    const fade = Math.max(0, 1 - e / 900);
    ctx.globalAlpha = (dark ? 0.14 : 0.12) * Math.min(1, e / 60) * fade * fade;
    ctx.fillStyle = dark ? "rgb(225,235,250)" : "rgb(95,120,155)";
    ctx.fillRect(0, 0, w, h);

    if (e < 220) {
      const a = 1 - e / 220;
      ctx.lineJoin = "round";
      ctx.strokeStyle = dark ? "rgb(234,242,255)" : "rgb(91,115,153)";
      for (const [lw, al] of [[7, 0.16], [1.6, 0.85]] as const) {
        ctx.globalAlpha = a * al;
        ctx.lineWidth = lw;
        ctx.beginPath();
        s.bolt.forEach(([bx, by], i) => (i ? ctx.lineTo(bx, by) : ctx.moveTo(bx, by)));
        ctx.stroke();
      }
    }
  }
}

function rgbOf(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
