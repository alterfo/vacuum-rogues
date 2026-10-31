import { scaledFont } from "@/utils/fontScale";
import { MONO_CHAR_WIDTH_RATIO, lineStepFor } from "./questCardLayout";

export const STAR_MAP_LABEL_PX = 10;

export function starMapLabelBounds(name: string): {
  width: number;
  height: number;
} {
  return {
    width: name.length * scaledFont(STAR_MAP_LABEL_PX) * MONO_CHAR_WIDTH_RATIO,
    height: lineStepFor(scaledFont(STAR_MAP_LABEL_PX)),
  };
}
