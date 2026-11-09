import type { Tone } from "./types";

/** Perceived lightness of a CSS colour string ("#rrggbb", "rgb()", "rgba()");
 *  null when it can't be read or is fully transparent. */
export function lightnessOf(color: string): number | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  let r: number, g: number, b: number, a = 1;
  if (hex) {
    const n = parseInt(hex[1], 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    const m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(color.trim());
    if (!m) return null;
    r = +m[1];
    g = +m[2];
    b = +m[3];
    if (m[4] !== undefined) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  }
  if (a < 0.05) return null;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function toneOfColor(color: string): Tone {
  const y = lightnessOf(color);
  return y !== null && y < 128 ? "dark" : "light";
}

/**
 * The tone of the page: whether the background behind the sky is dark or
 * light, which decides colours (a white snowflake vanishes on white paper).
 * Reads the first opaque background from `<body>` up to `<html>`, and falls
 * back to the visitor's colour-scheme preference.
 */
export function detectTone(): Tone {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const y = lightnessOf(getComputedStyle(el).backgroundColor);
    if (y !== null) return y < 128 ? "dark" : "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Calls `cb` when the page's tone may have changed: a class, `data-theme` or
 *  inline style changed on `<html>` or `<body>`, or the OS scheme flipped.
 *
 *  Themes often fade their background, and a colour read mid-fade is neither
 *  one nor the other. So it re-checks when a background transition on the root
 *  or body ends, and once more a moment later for pages that animate some
 *  other way. `cb` should be cheap and idempotent. */
export function watchTone(cb: () => void): () => void {
  let queued = 0;
  let settle: ReturnType<typeof setTimeout> | undefined;
  const poke = () => {
    cancelAnimationFrame(queued);
    clearTimeout(settle);
    // After the new styles have been applied.
    queued = requestAnimationFrame(() => requestAnimationFrame(cb));
    settle = setTimeout(cb, 700);
  };
  const onEnd = (e: Event) => {
    const t = e.target;
    const prop = (e as TransitionEvent).propertyName;
    if ((t === document.documentElement || t === document.body) && /background/.test(prop)) cb();
  };
  const mo = new MutationObserver(poke);
  const opts = { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-mode"] };
  mo.observe(document.documentElement, opts);
  if (document.body) mo.observe(document.body, opts);
  document.addEventListener("transitionend", onEnd, true);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener?.("change", poke);
  return () => {
    cancelAnimationFrame(queued);
    clearTimeout(settle);
    mo.disconnect();
    document.removeEventListener("transitionend", onEnd, true);
    mq.removeEventListener?.("change", poke);
  };
}
