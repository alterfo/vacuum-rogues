import { helpButtonRect } from "../ui/mountSceneHelp";

export const STAR_MAP_BUTTON_SIZE = 34;
export const STAR_MAP_BUTTON_GAP = 12;

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
