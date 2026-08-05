import type { Application } from "pixi.js";
import { texUrl } from "./textures";

export type GameCursor = "default" | "target" | "landing" | "grab";

const FALLBACK: Record<GameCursor, string> = {
  default: "default",
  target: "crosshair",
  landing: "pointer",
  grab: "grab",
};

const HOTSPOT: Record<GameCursor, [number, number]> = {
  default: [2, 2],
  target: [16, 16],
  landing: [16, 16],
  grab: [16, 16],
};

function cssCursor(kind: GameCursor): string {
  const url = texUrl(`ui/cursor_${kind}`);
  if (url) {
    const [hx, hy] = HOTSPOT[kind];
    return `url(${url}) ${hx} ${hy}, ${FALLBACK[kind]}`;
  }
  return FALLBACK[kind];
}

export function installGameCursors(app: Application): void {
  const styles = app.renderer?.events?.cursorStyles as
    | Record<string, string>
    | undefined;
  if (styles) {
    styles.default = cssCursor("default");
    styles.pointer = cssCursor("landing"); // hover over interactive UI / planets
    styles.target = cssCursor("target");
    styles.landing = cssCursor("landing");
    styles.grab = cssCursor("grab");
  }
  if (app.canvas) app.canvas.style.cursor = cssCursor("default");
}

export function setCanvasCursor(app: Application, kind: GameCursor): void {
  if (app.canvas) app.canvas.style.cursor = cssCursor(kind);
}
