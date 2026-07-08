import { helpButtonRect } from "../ui/mountSceneHelp";

/** Size of the square star-map icon button (matches the «?» help button). */
export const STAR_MAP_BUTTON_SIZE = 34;
/** Gap between the star-map button's right edge and the help corner's left edge. */
export const STAR_MAP_BUTTON_GAP = 12;

/**
 * The star-map button's rect for a given screen width — always immediately left
 * of {@link helpButtonRect} (the single source of truth for the help corner) with
 * a fixed gap, so the two can never overlap regardless of screen size (Bug 1).
 */
export function starMapButtonRect(screenWidth: number): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const help = helpButtonRect(screenWidth);
  return {
    x: help.x - STAR_MAP_BUTTON_GAP - STAR_MAP_BUTTON_SIZE,
    y: help.y,
    w: STAR_MAP_BUTTON_SIZE,
    h: STAR_MAP_BUTTON_SIZE,
  };
}
