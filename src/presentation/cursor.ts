/**
 * Game cursor styling (US-070 #5).
 *
 * Registers a small set of context cursors with the PixiJS event system so the
 * pointer changes shape over different game objects: a default arrow in space,
 * a targeting reticle over hostile ships, a landing marker over planets, and a
 * grab hand while panning. Each cursor prefers generated art dropped into
 * `src/assets/ui/cursor_<kind>.png`; until that art exists it falls back to a
 * themed built-in CSS cursor, so the game already feels "cursored" and upgrades
 * automatically once the art is added.
 */
import type { Application } from "pixi.js";
import { texUrl } from "./textures";

/** Logical cursor kinds; objects set `displayObject.cursor = <kind>`. */
export type GameCursor = "default" | "target" | "landing" | "grab";

/** CSS fallbacks used until cursor art is generated. */
const FALLBACK: Record<GameCursor, string> = {
  default: "default",
  target: "crosshair",
  landing: "pointer",
  grab: "grab",
};

/** Hotspot (in px) for each art cursor, measured from the top-left. */
const HOTSPOT: Record<GameCursor, [number, number]> = {
  default: [2, 2],
  target: [16, 16],
  landing: [16, 16],
  grab: [16, 16],
};

/** Resolve a cursor kind to a CSS cursor value (art url() or built-in). */
function cssCursor(kind: GameCursor): string {
  const url = texUrl(`ui/cursor_${kind}`);
  if (url) {
    const [hx, hy] = HOTSPOT[kind];
    return `url(${url}) ${hx} ${hy}, ${FALLBACK[kind]}`;
  }
  return FALLBACK[kind];
}

/**
 * Register the game cursors with the app's event system and set the default.
 * Call once when a scene that wants game cursors initializes.
 */
export function installGameCursors(app: Application): void {
  // Guard against headless/mocked renderers (unit tests) where the event
  // system isn't wired up.
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
  // Apply the default immediately so the cursor isn't a bare arrow until first
  // hover.
  if (app.canvas) app.canvas.style.cursor = cssCursor("default");
}

/**
 * Force the canvas cursor to a specific kind (e.g. "grab" while panning, where
 * no display object is hovered to drive the style). Pass "default" to release.
 */
export function setCanvasCursor(app: Application, kind: GameCursor): void {
  if (app.canvas) app.canvas.style.cursor = cssCursor(kind);
}
