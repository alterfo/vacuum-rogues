import { Texture } from "pixi.js";
import type {
  ArcadeBulletKind,
  ArcadePickupKind,
} from "@/systems/blackHoleArcade/arcadeTypes";

export interface ArcadeTheme {
  bg: number;
  accent: number;
  ground: number;
  nebula: number;
}

export const ARCADE_THEMES: readonly ArcadeTheme[] = [
  { bg: 0x06040f, accent: 0x7a5cff, ground: 0x15122a, nebula: 0x4a2cc0 },
  { bg: 0x0f0405, accent: 0xff4a2e, ground: 0x241010, nebula: 0xc02c1c },
  { bg: 0x03090f, accent: 0x2ee6d6, ground: 0x0c1c22, nebula: 0x1c9aa8 },
  { bg: 0x0f0903, accent: 0xffb02e, ground: 0x241a0a, nebula: 0xc0801c },
  { bg: 0x070310, accent: 0xff3df2, ground: 0x1c1028, nebula: 0xa01cc0 },
];

export const PICKUP_COLOR: Readonly<Record<ArcadePickupKind, number>> = {
  weapon_vulcan: 0xff4d4d,
  weapon_laser: 0x4da6ff,
  weapon_homing: 0x5eea7a,
  weapon_wave: 0x39e0e0,
  weapon_plasma: 0xff9a3c,
  weapon_arc: 0xc78bff,
  power: 0xffe066,
  repair_small: 0x7dffb0,
  repair_full: 0x3dff8a,
  plating: 0xb8c4d8,
  armor_coat: 0xffd27a,
  shield: 0x59c8ff,
  bomb: 0xff6a6a,
  wingman: 0xffa8e8,
  magnet: 0xe0e0ff,
  chip: 0xffd24a,
};

export const BULLET_COLOR: Readonly<Record<ArcadeBulletKind, number>> = {
  pulse: 0xff6a5a,
  laser: 0x58b4ff,
  missile: 0x7dff9a,
  wave: 0x4ff0ee,
  plasma: 0xffa040,
  drone: 0xfff0a0,
  enemyOrb: 0xff3d7f,
  enemyNeedle: 0xff7ab0,
  enemyBig: 0xff7a2e,
  enemyMine: 0xff4040,
};

export interface ArcadeArt {
  glow: Texture;
  ring: Texture;
  spark: Texture;
  flame: Texture;
  shieldBubble: Texture;
  drone: Texture;
  turret: Texture;
  tank: Texture;
  nebula: Texture;
  disc: Texture;
  bullets: Record<ArcadeBulletKind, Texture>;
  pickups: Record<ArcadePickupKind, Texture>;
  terrain: Texture[];
  stars: Texture[];
}

type Ctx = CanvasRenderingContext2D;

function hex(color: number, alpha = 1): string {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function canvasSupported(): boolean {
  if (typeof document === "undefined") return false;
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) {
    return false;
  }
  return true;
}

function paint(
  w: number,
  h: number,
  draw: (ctx: Ctx, w: number, h: number) => void,
): Texture {
  if (!canvasSupported()) return Texture.WHITE;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Texture.WHITE;
  draw(ctx, w, h);
  return Texture.from(canvas);
}

function radial(
  ctx: Ctx,
  cx: number,
  cy: number,
  r: number,
  stops: readonly (readonly [number, string])[],
): CanvasGradient {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [at, color] of stops) g.addColorStop(at, color);
  return g;
}

function seeded(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGlow(): Texture {
  return paint(128, 128, (ctx, w, h) => {
    ctx.fillStyle = radial(ctx, w / 2, h / 2, w / 2, [
      [0, "rgba(255,255,255,1)"],
      [0.25, "rgba(255,255,255,0.55)"],
      [0.6, "rgba(255,255,255,0.12)"],
      [1, "rgba(255,255,255,0)"],
    ]);
    ctx.fillRect(0, 0, w, h);
  });
}

function makeRing(): Texture {
  return paint(256, 256, (ctx, w, h) => {
    ctx.fillStyle = radial(ctx, w / 2, h / 2, w / 2, [
      [0, "rgba(255,255,255,0)"],
      [0.8, "rgba(255,255,255,0.05)"],
      [0.92, "rgba(255,255,255,0.9)"],
      [1, "rgba(255,255,255,0)"],
    ]);
    ctx.fillRect(0, 0, w, h);
  });
}

function makeSpark(): Texture {
  return paint(32, 32, (ctx, w, h) => {
    ctx.fillStyle = radial(ctx, w / 2, h / 2, w / 2, [
      [0, "rgba(255,255,255,1)"],
      [0.4, "rgba(255,230,160,0.6)"],
      [1, "rgba(255,160,60,0)"],
    ]);
    ctx.fillRect(0, 0, w, h);
  });
}

function makeFlame(): Texture {
  return paint(48, 96, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.25, "rgba(120,220,255,0.8)");
    g.addColorStop(1, "rgba(60,120,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(w / 2, h);
    ctx.bezierCurveTo(w * 0.05, h * 0.55, w * 0.1, h * 0.05, w / 2, 0);
    ctx.bezierCurveTo(w * 0.9, h * 0.05, w * 0.95, h * 0.55, w / 2, h);
    ctx.fill();
  });
}

function makeShieldBubble(): Texture {
  return paint(256, 256, (ctx, w, h) => {
    ctx.fillStyle = radial(ctx, w / 2, h / 2, w / 2, [
      [0, "rgba(90,200,255,0)"],
      [0.7, "rgba(90,200,255,0.08)"],
      [0.9, "rgba(140,225,255,0.45)"],
      [0.97, "rgba(220,245,255,0.95)"],
      [1, "rgba(220,245,255,0)"],
    ]);
    ctx.fillRect(0, 0, w, h);
  });
}

function makeDrone(): Texture {
  return paint(48, 48, (ctx, w, h) => {
    ctx.fillStyle = radial(ctx, w / 2, h / 2, w / 2, [
      [0, "rgba(255,230,160,0.55)"],
      [1, "rgba(255,230,160,0)"],
    ]);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#c9d4e8";
    ctx.beginPath();
    ctx.moveTo(w / 2, 8);
    ctx.lineTo(w - 12, h - 10);
    ctx.lineTo(w / 2, h - 16);
    ctx.lineTo(12, h - 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#59c8ff";
    ctx.beginPath();
    ctx.arc(w / 2, h / 2 + 2, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function capsule(
  ctx: Ctx,
  w: number,
  h: number,
  color: number,
  core = 1,
): void {
  const cx = w / 2;
  ctx.fillStyle = radial(ctx, cx, h / 2, Math.max(w, h) / 2, [
    [0, hex(color, 0.5)],
    [1, hex(color, 0)],
  ]);
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(cx - w * 0.25, 0, cx + w * 0.25, 0);
  g.addColorStop(0, hex(color, 0.9));
  g.addColorStop(0.5, `rgba(255,255,255,${core})`);
  g.addColorStop(1, hex(color, 0.9));
  ctx.fillStyle = g;
  const r = w * 0.22;
  ctx.beginPath();
  ctx.roundRect(cx - r, h * 0.12, r * 2, h * 0.76, r);
  ctx.fill();
}

function ball(ctx: Ctx, size: number, color: number, ringed: boolean): void {
  const c = size / 2;
  ctx.fillStyle = radial(ctx, c, c, c, [
    [0, "rgba(255,255,255,1)"],
    [0.28, hex(color, 0.95)],
    [0.62, hex(color, 0.35)],
    [1, hex(color, 0)],
  ]);
  ctx.fillRect(0, 0, size, size);
  if (ringed) {
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c, c, c * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function makeBullets(): Record<ArcadeBulletKind, Texture> {
  return {
    pulse: paint(24, 56, (ctx, w, h) => capsule(ctx, w, h, BULLET_COLOR.pulse)),
    laser: paint(20, 96, (ctx, w, h) =>
      capsule(ctx, w, h, BULLET_COLOR.laser, 1),
    ),
    missile: paint(32, 64, (ctx, w, h) => {
      ctx.fillStyle = radial(ctx, w / 2, h * 0.8, w, [
        [0, "rgba(255,255,255,0.95)"],
        [0.3, hex(BULLET_COLOR.missile, 0.6)],
        [1, hex(BULLET_COLOR.missile, 0)],
      ]);
      ctx.fillRect(0, h * 0.45, w, h * 0.55);
      ctx.fillStyle = "#dfe8f4";
      ctx.beginPath();
      ctx.moveTo(w / 2, 4);
      ctx.lineTo(w / 2 + 6, h * 0.62);
      ctx.lineTo(w / 2 - 6, h * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = hex(BULLET_COLOR.missile);
      ctx.fillRect(w / 2 - 6, h * 0.5, 12, 4);
    }),
    wave: paint(40, 40, (ctx, w) => ball(ctx, w, BULLET_COLOR.wave, true)),
    plasma: paint(96, 96, (ctx, w) => ball(ctx, w, BULLET_COLOR.plasma, true)),
    drone: paint(16, 40, (ctx, w, h) => capsule(ctx, w, h, BULLET_COLOR.drone)),
    enemyOrb: paint(36, 36, (ctx, w) =>
      ball(ctx, w, BULLET_COLOR.enemyOrb, false),
    ),
    enemyNeedle: paint(16, 48, (ctx, w, h) =>
      capsule(ctx, w, h, BULLET_COLOR.enemyNeedle, 0.9),
    ),
    enemyBig: paint(64, 64, (ctx, w) =>
      ball(ctx, w, BULLET_COLOR.enemyBig, true),
    ),
    enemyMine: paint(64, 64, (ctx, w, h) => {
      const c = w / 2;
      ctx.fillStyle = radial(ctx, c, c, c, [
        [0, hex(BULLET_COLOR.enemyMine, 0.45)],
        [1, hex(BULLET_COLOR.enemyMine, 0)],
      ]);
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#8a93a6";
      ctx.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * 12, c + Math.sin(a) * 12);
        ctx.lineTo(c + Math.cos(a) * 24, c + Math.sin(a) * 24);
        ctx.stroke();
      }
      ctx.fillStyle = "#3a4152";
      ctx.beginPath();
      ctx.arc(c, c, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hex(BULLET_COLOR.enemyMine);
      ctx.beginPath();
      ctx.arc(c, c, 5, 0, Math.PI * 2);
      ctx.fill();
    }),
  };
}

function glyph(
  ctx: Ctx,
  kind: ArcadePickupKind,
  c: number,
  color: number,
): void {
  const col = hex(color);
  ctx.lineWidth = 4;
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const letter = (s: string): void => {
    ctx.font = "bold 34px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(s, c, c + 2);
  };
  switch (kind) {
    case "weapon_vulcan":
      letter("V");
      break;
    case "weapon_laser":
      letter("L");
      break;
    case "weapon_homing":
      letter("H");
      break;
    case "weapon_wave":
      letter("W");
      break;
    case "weapon_plasma":
      letter("P");
      break;
    case "weapon_arc":
      letter("A");
      break;
    case "power":
      ctx.beginPath();
      ctx.moveTo(c, c - 18);
      ctx.lineTo(c + 16, c + 4);
      ctx.lineTo(c + 6, c + 4);
      ctx.lineTo(c + 6, c + 18);
      ctx.lineTo(c - 6, c + 18);
      ctx.lineTo(c - 6, c + 4);
      ctx.lineTo(c - 16, c + 4);
      ctx.closePath();
      ctx.fill();
      break;
    case "repair_small":
    case "repair_full": {
      const arm = kind === "repair_full" ? 20 : 14;
      ctx.lineWidth = kind === "repair_full" ? 9 : 7;
      ctx.beginPath();
      ctx.moveTo(c - arm, c);
      ctx.lineTo(c + arm, c);
      ctx.moveTo(c, c - arm);
      ctx.lineTo(c, c + arm);
      ctx.stroke();
      break;
    }
    case "plating":
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const x = c + Math.cos(a) * 18;
        const y = c + Math.sin(a) * 18;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c, c, 6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "armor_coat":
      for (const dy of [-10, 4, 18]) {
        ctx.beginPath();
        ctx.moveTo(c - 15, c + dy - 4);
        ctx.lineTo(c, c + dy - 14);
        ctx.lineTo(c + 15, c + dy - 4);
        ctx.stroke();
      }
      break;
    case "shield":
      ctx.beginPath();
      ctx.moveTo(c, c - 20);
      ctx.lineTo(c + 17, c - 12);
      ctx.lineTo(c + 15, c + 6);
      ctx.quadraticCurveTo(c + 10, c + 17, c, c + 22);
      ctx.quadraticCurveTo(c - 10, c + 17, c - 15, c + 6);
      ctx.lineTo(c - 17, c - 12);
      ctx.closePath();
      ctx.stroke();
      break;
    case "bomb":
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(c, c - 3, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(c - 9, c + 8, 18, 10);
      ctx.fillStyle = "#1a0a0a";
      ctx.beginPath();
      ctx.arc(c - 6, c - 3, 4.5, 0, Math.PI * 2);
      ctx.arc(c + 6, c - 3, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(c - 1.5, c + 3, 3, 5);
      for (const dx of [-5, 0, 5]) ctx.fillRect(c + dx - 1, c + 11, 2, 7);
      break;
    case "wingman":
      ctx.beginPath();
      ctx.moveTo(c - 20, c + 8);
      ctx.lineTo(c - 8, c - 4);
      ctx.lineTo(c - 8, c + 8);
      ctx.moveTo(c + 20, c + 8);
      ctx.lineTo(c + 8, c - 4);
      ctx.lineTo(c + 8, c + 8);
      ctx.moveTo(c, c - 18);
      ctx.lineTo(c + 6, c + 14);
      ctx.lineTo(c - 6, c + 14);
      ctx.closePath();
      ctx.stroke();
      break;
    case "magnet":
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(c, c - 2, 14, Math.PI, 0);
      ctx.moveTo(c - 14, c - 2);
      ctx.lineTo(c - 14, c + 14);
      ctx.moveTo(c + 14, c - 2);
      ctx.lineTo(c + 14, c + 14);
      ctx.stroke();
      break;
    case "chip":
      ctx.beginPath();
      ctx.arc(c, c, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = "bold 24px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.fillText("₡", c, c + 1);
      break;
  }
}

function makePickup(kind: ArcadePickupKind, color: number): Texture {
  return paint(80, 80, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = radial(ctx, c, c, c, [
      [0.3, hex(color, 0.5)],
      [1, hex(color, 0)],
    ]);
    ctx.fillRect(0, 0, w, w);
    ctx.fillStyle = "rgba(8,10,20,0.82)";
    ctx.beginPath();
    ctx.arc(c, c, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hex(color);
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c, c, 23, 0, Math.PI * 2);
    ctx.stroke();
    glyph(ctx, kind, c, color);
  });
}

function makePickups(): Record<ArcadePickupKind, Texture> {
  const out = {} as Record<ArcadePickupKind, Texture>;
  for (const kind of Object.keys(PICKUP_COLOR) as ArcadePickupKind[]) {
    out[kind] = makePickup(kind, PICKUP_COLOR[kind]);
  }
  return out;
}

function steelDisc(ctx: Ctx, c: number, r: number): void {
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.arc(c + 3, c + 5, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = radial(ctx, c - r * 0.3, c - r * 0.3, r * 1.4, [
    [0, "#6b7589"],
    [1, "#262c3a"],
  ]);
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#8d98ad";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function makeTurret(): Texture {
  return paint(96, 96, (ctx, w) => {
    const c = w / 2;
    steelDisc(ctx, c, 34);
    ctx.fillStyle = "#4a5266";
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * 28, c + Math.sin(a) * 28, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#2a3040";
    ctx.beginPath();
    ctx.roundRect(c - 7, c - 40, 14, 40, 3);
    ctx.fill();
    ctx.strokeStyle = "#9aa6bd";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#3a4256";
    ctx.beginPath();
    ctx.arc(c, c, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = radial(ctx, c, c, 9, [
      [0, "#ffffff"],
      [0.4, "#ff5a5a"],
      [1, "rgba(255,40,40,0)"],
    ]);
    ctx.fillRect(c - 10, c - 10, 20, 20);
  });
}

function makeTank(): Texture {
  return paint(128, 128, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(c - 38, c - 44, 80, 92);
    for (const sx of [-1, 1]) {
      ctx.fillStyle = "#1c212d";
      ctx.beginPath();
      ctx.roundRect(c + sx * 34 - 11, c - 46, 22, 92, 8);
      ctx.fill();
      ctx.strokeStyle = "#566077";
      ctx.lineWidth = 1.5;
      for (let y = -42; y < 46; y += 8) {
        ctx.beginPath();
        ctx.moveTo(c + sx * 34 - 10, c + y);
        ctx.lineTo(c + sx * 34 + 10, c + y);
        ctx.stroke();
      }
    }
    ctx.fillStyle = radial(ctx, c - 8, c - 14, 50, [
      [0, "#6f7a90"],
      [1, "#2a303f"],
    ]);
    ctx.beginPath();
    ctx.roundRect(c - 28, c - 38, 56, 76, 10);
    ctx.fill();
    ctx.strokeStyle = "#a3aec4";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#2e3546";
    ctx.beginPath();
    ctx.roundRect(c - 6, c - 54, 12, 44, 3);
    ctx.fill();
    ctx.strokeStyle = "#a3aec4";
    ctx.stroke();
    steelDisc(ctx, c, 17);
    ctx.fillStyle = "#ff5a5a";
    ctx.beginPath();
    ctx.arc(c, c, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function makeTerrain(theme: ArcadeTheme, seed: number): Texture {
  return paint(512, 512, (ctx, w, h) => {
    const rnd = seeded(seed * 977 + 13);
    ctx.fillStyle = hex(theme.ground);
    ctx.fillRect(0, 0, w, h);
    const cell = 128;
    for (let gy = 0; gy < h / cell; gy++) {
      for (let gx = 0; gx < w / cell; gx++) {
        const shade = 0.55 + rnd() * 0.5;
        ctx.fillStyle = `rgba(255,255,255,${0.025 * shade})`;
        ctx.fillRect(gx * cell + 3, gy * cell + 3, cell - 6, cell - 6);
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 3;
        ctx.strokeRect(gx * cell + 1.5, gy * cell + 1.5, cell - 3, cell - 3);
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.lineWidth = 1;
        ctx.strokeRect(gx * cell + 5.5, gy * cell + 5.5, cell - 11, cell - 11);
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        for (const [rx, ry] of [
          [10, 10],
          [cell - 10, 10],
          [10, cell - 10],
          [cell - 10, cell - 10],
        ]) {
          ctx.beginPath();
          ctx.arc(gx * cell + rx, gy * cell + ry, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        const roll = rnd();
        if (roll < 0.22) {
          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.beginPath();
          ctx.arc(
            gx * cell + cell / 2,
            gy * cell + cell / 2,
            26 + rnd() * 10,
            0,
            Math.PI * 2,
          );
          ctx.fill();
          ctx.strokeStyle = hex(theme.accent, 0.35);
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (roll < 0.4) {
          ctx.fillStyle = hex(theme.accent, 0.12);
          ctx.fillRect(gx * cell + 24, gy * cell + 24, cell - 48, 10);
          ctx.fillStyle = hex(theme.accent, 0.5);
          ctx.fillRect(gx * cell + 28, gy * cell + 27, 22 + rnd() * 40, 4);
        }
      }
    }
    for (const x of [0, w]) {
      ctx.strokeStyle = hex(theme.accent, 0.22);
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.strokeStyle = hex(theme.accent, 0.7);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    for (const y of [0, h]) {
      ctx.strokeStyle = hex(theme.accent, 0.12);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  });
}

function makeStars(density: number, maxSize: number, seed: number): Texture {
  return paint(512, 512, (ctx, w, h) => {
    const rnd = seeded(seed);
    for (let i = 0; i < density; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const size = 0.5 + rnd() * maxSize;
      const tint = rnd();
      ctx.fillStyle =
        tint < 0.15
          ? "rgba(255,200,170,0.9)"
          : tint < 0.3
            ? "rgba(170,200,255,0.9)"
            : "rgba(255,255,255,0.85)";
      ctx.globalAlpha = 0.35 + rnd() * 0.65;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      if (size > 1.4) {
        ctx.globalAlpha *= 0.1;
        ctx.beginPath();
        ctx.arc(x, y, size * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  });
}

function makeNebula(): Texture {
  return paint(512, 512, (ctx, w, h) => {
    const rnd = seeded(404);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 14; i++) {
      const x = w * (0.2 + rnd() * 0.6);
      const y = h * (0.2 + rnd() * 0.6);
      const r = 90 + rnd() * 150;
      ctx.fillStyle = radial(ctx, x, y, r, [
        [0, `rgba(255,255,255,${0.1 + rnd() * 0.12})`],
        [0.5, "rgba(255,255,255,0.05)"],
        [1, "rgba(255,255,255,0)"],
      ]);
      ctx.fillRect(0, 0, w, h);
    }
  });
}

function makeDisc(): Texture {
  return paint(1024, 1024, (ctx, w, h) => {
    const c = w / 2;
    ctx.fillStyle = radial(ctx, c, c, c, [
      [0, "rgba(0,0,0,1)"],
      [0.2, "rgba(0,0,0,1)"],
      [0.24, "rgba(255,240,200,0.95)"],
      [0.3, "rgba(255,160,60,0.7)"],
      [0.55, "rgba(255,90,40,0.22)"],
      [1, "rgba(255,60,30,0)"],
    ]);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = radial(ctx, c, c, c * 0.23, [
      [0, "rgba(0,0,0,1)"],
      [0.92, "rgba(0,0,0,1)"],
      [1, "rgba(0,0,0,0)"],
    ]);
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = "round";
    for (let arm = 0; arm < 4; arm++) {
      ctx.strokeStyle = `rgba(255,${150 + arm * 20},90,0.16)`;
      ctx.lineWidth = 14;
      ctx.beginPath();
      for (let t = 0; t <= 1; t += 0.02) {
        const a = arm * (Math.PI / 2) + t * 5.4;
        const r = c * (0.26 + t * 0.7);
        const x = c + Math.cos(a) * r;
        const y = c + Math.sin(a) * r;
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

let cached: ArcadeArt | null = null;

export function getArcadeArt(): ArcadeArt {
  if (cached) return cached;
  cached = {
    glow: makeGlow(),
    ring: makeRing(),
    spark: makeSpark(),
    flame: makeFlame(),
    shieldBubble: makeShieldBubble(),
    drone: makeDrone(),
    turret: makeTurret(),
    tank: makeTank(),
    nebula: makeNebula(),
    disc: makeDisc(),
    bullets: makeBullets(),
    pickups: makePickups(),
    terrain: ARCADE_THEMES.map((theme, i) => makeTerrain(theme, i + 1)),
    stars: [
      makeStars(90, 0.8, 11),
      makeStars(46, 1.1, 22),
      makeStars(18, 1.5, 33),
    ],
  };
  return cached;
}

export function resetArcadeArtCache(): void {
  cached = null;
}
