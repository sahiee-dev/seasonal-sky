import type { Kind } from "./types";

/**
 * Particle sprites, drawn once into small offscreen canvases and then stamped
 * every frame. Drawing a bezier leaf 150 times per frame would be wasteful;
 * `drawImage` of a cached bitmap is not.
 *
 * Every shape is drawn in a unit square (-1..1) so one function serves any
 * size. Sizes are bucketed to multiples of 4 device pixels so a few dozen
 * sprites cover every particle.
 */

type SpriteKind = Exclude<Kind, "rain" | "sleet">;

const cache = new Map<string, HTMLCanvasElement>();

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

export function sprite(
  kind: SpriteKind,
  color: string,
  sizeCss: number,
  dpr: number
): HTMLCanvasElement {
  const px = Math.max(4, Math.round((sizeCss * dpr) / 4) * 4);
  const key = `${kind}|${color}|${px}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const c = document.createElement("canvas");
  c.width = c.height = px;
  const ctx = c.getContext("2d")!;
  ctx.translate(px / 2, px / 2);
  ctx.scale(px / 2, px / 2);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  DRAW[kind](ctx, color, px);
  cache.set(key, c);
  return c;
}

/** Stems and veins are a fixed fraction of the sprite, so they stay visible
 *  on small leaves instead of vanishing under 1px. */
const hairline = (px: number) => Math.max(0.06, 1.2 / (px / 2));

const DRAW: Record<
  SpriteKind,
  (ctx: CanvasRenderingContext2D, color: string, px: number) => void
> = {
  /* A five-pointed leaf, built from polar (angle from straight up, radius)
     pairs for the right half and mirrored. */
  maple(ctx, color, px) {
    const half: [number, number][] = [
      [0, 1.0], [15, 0.52], [36, 0.74], [48, 0.98], [60, 0.6],
      [82, 0.8], [98, 0.58], [120, 0.5], [142, 0.46], [162, 0.34], [180, 0.28],
    ];
    const pt = ([a, r]: [number, number], s: number): [number, number] => {
      const t = (a * Math.PI) / 180;
      return [Math.sin(t) * r * s, -Math.cos(t) * r - 0.05];
    };
    ctx.beginPath();
    half.forEach((h, i) => {
      const [x, y] = pt(h, 1);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    [...half].reverse().forEach((h) => {
      const [x, y] = pt(h, -1);
      ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = rgba("#000000", 0.28);
    ctx.lineWidth = hairline(px);
    ctx.beginPath();
    ctx.moveTo(0, 0.2);
    ctx.lineTo(0, -0.95);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0.2);
    ctx.lineTo(0, 1);
    ctx.strokeStyle = color;
    ctx.stroke();
  },

  /* Elongated, with rounded lobes that get bigger toward the middle and a
     narrow body, so the notches between them show. */
  oak(ctx, color, px) {
    ctx.save();
    ctx.scale(0.85, 1);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0.02, 0.3, 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
    const lobes: [number, number, number][] = [
      [0.3, -0.62, 0.2],
      [0.4, -0.22, 0.25],
      [0.4, 0.18, 0.25],
      [0.3, 0.56, 0.19],
    ];
    for (const [x, y, r] of lobes) {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.beginPath();
    ctx.arc(0, -0.8, 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = rgba("#000000", 0.25);
    ctx.lineWidth = hairline(px);
    ctx.beginPath();
    ctx.moveTo(0, 0.9);
    ctx.lineTo(0, -0.8);
    ctx.stroke();
  },

  /* A wide fan: straight sides from a narrow base, a broad rounded top and a
     shallow notch, with veins radiating out. */
  ginkgo(ctx, _color, px) {
    ctx.fillStyle = "#e3b32e"; // always gold, whatever the palette says
    ctx.beginPath();
    ctx.moveTo(0, 0.95);
    ctx.lineTo(-0.72, -0.5);
    ctx.bezierCurveTo(-0.98, -1.0, -0.3, -1.08, -0.05, -0.82);
    ctx.lineTo(0, -0.74);
    ctx.lineTo(0.05, -0.82);
    ctx.bezierCurveTo(0.3, -1.08, 0.98, -1.0, 0.72, -0.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba("#000000", 0.2);
    ctx.lineWidth = hairline(px);
    for (const x of [-0.5, -0.2, 0.2, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(0, 0.9);
      ctx.lineTo(x, -0.85);
      ctx.stroke();
    }
  },

  /* A plain pointed leaf with a lighter midrib. */
  leaf(ctx, color, px) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0.95);
    ctx.bezierCurveTo(-0.8, 0.4, -0.7, -0.55, 0, -1);
    ctx.bezierCurveTo(0.7, -0.55, 0.8, 0.4, 0, 0.95);
    ctx.fill();
    ctx.strokeStyle = rgba("#ffffff", 0.35);
    ctx.lineWidth = hairline(px);
    ctx.beginPath();
    ctx.moveTo(0, 0.9);
    ctx.lineTo(0, -0.8);
    ctx.stroke();
  },

  /* A rounded teardrop with a small notch. */
  petal(ctx, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0.92);
    ctx.bezierCurveTo(-1.0, 0.35, -0.85, -0.85, -0.12, -0.9);
    ctx.lineTo(0, -0.74);
    ctx.lineTo(0.12, -0.9);
    ctx.bezierCurveTo(0.85, -0.85, 1.0, 0.35, 0, 0.92);
    ctx.fill();
  },

  /* A soft round flake: solid core, feathered edge. */
  flake(ctx, color) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, rgba(color, 1));
    g.addColorStop(0.5, rgba(color, 0.85));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
  },

  /* A glow with a bright pinprick at the centre. */
  firefly(ctx, color) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, "rgba(255,255,225,1)");
    g.addColorStop(0.12, rgba(color, 0.95));
    g.addColorStop(0.4, rgba(color, 0.32));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
  },
};
