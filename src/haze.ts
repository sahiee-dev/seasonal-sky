import type { Haze, Tone } from "./types";

/**
 * Fog and overcast: a few huge, soft gradients drifting slowly. Pure CSS, so
 * it costs nothing per frame. Fog fills the screen; cloud sits along the top.
 * `intensity` (0 to 1) scales the whole layer, which is how a blizzard becomes
 * a whiteout and a drizzle only a slight dimming. Faint and click-through so
 * it never fights the text. It fades in and out rather than popping.
 */

const STYLE_ID = "seasonal-sky-styles";

const CSS = `
.ss-canvas{position:fixed;inset:0;width:100%;height:100%;pointer-events:none}
.ss-haze{position:fixed;inset:0;overflow:hidden;pointer-events:none;opacity:0;transition:opacity 1.6s ease}
.ss-haze[data-tone="light"]{--ss-haze:rgba(135,146,162,.3)}
.ss-haze[data-tone="dark"]{--ss-haze:rgba(205,215,232,.19)}
.ss-haze i{position:absolute;border-radius:50%;background:radial-gradient(closest-side,var(--ss-haze),transparent);animation:ss-drift var(--ss-dur,70s) ease-in-out infinite alternate}
.ss-haze--fog i:nth-child(1){width:110vw;height:55vh;left:-20vw;top:-8vh;--ss-dur:80s}
.ss-haze--fog i:nth-child(2){width:100vw;height:50vh;right:-25vw;top:28vh;--ss-dur:65s;animation-direction:alternate-reverse}
.ss-haze--fog i:nth-child(3){width:120vw;height:55vh;left:-10vw;bottom:-12vh;--ss-dur:90s}
.ss-haze--fog i:nth-child(4){width:70vw;height:40vh;left:25vw;top:40vh;--ss-dur:55s;animation-direction:alternate-reverse}
.ss-haze--cloudy i:nth-child(1){width:70vw;height:32vh;left:-15vw;top:-14vh;--ss-dur:75s}
.ss-haze--cloudy i:nth-child(2){width:60vw;height:28vh;left:30vw;top:-10vh;--ss-dur:60s;animation-direction:alternate-reverse}
.ss-haze--cloudy i:nth-child(3){width:65vw;height:30vh;right:-18vw;top:-12vh;--ss-dur:85s}
.ss-haze--cloudy i:nth-child(4){width:50vw;height:24vh;left:8vw;top:2vh;--ss-dur:70s;animation-direction:alternate-reverse}
@keyframes ss-drift{from{transform:translateX(-9vw)}to{transform:translateX(9vw)}}
@media (prefers-reduced-motion:reduce){.ss-haze i{animation:none}.ss-haze{transition:none}}
`;

/** Adds the stylesheet once per document. `nonce` is for pages with a strict
 *  style Content-Security-Policy. */
export function injectStyles(nonce?: string) {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  if (nonce) el.nonce = nonce;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export class HazeLayer {
  readonly el: HTMLDivElement;
  private kind: Haze["kind"] | null = null;

  constructor(zIndex: number) {
    this.el = document.createElement("div");
    this.el.className = "ss-haze";
    this.el.setAttribute("aria-hidden", "true");
    this.el.style.zIndex = String(zIndex);
    for (let i = 0; i < 4; i++) this.el.appendChild(document.createElement("i"));
  }

  update(haze: Haze | null, tone: Tone) {
    this.el.dataset.tone = tone;
    if (!haze) {
      this.el.style.opacity = "0";
      return;
    }
    if (haze.kind !== this.kind) {
      if (this.kind) this.el.classList.remove(`ss-haze--${this.kind}`);
      this.kind = haze.kind;
      this.el.classList.add(`ss-haze--${haze.kind}`);
    }
    // Cloud is a little thinner than fog at the same intensity.
    this.el.style.opacity = String(haze.kind === "cloudy" ? haze.intensity * 0.85 : haze.intensity);
  }
}
