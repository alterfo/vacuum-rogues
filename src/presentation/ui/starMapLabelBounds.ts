import { scaledFont } from "@/utils/fontScale";
import { estimateTextWidthPx, lineStepFor } from "./questCardLayout";

export const STAR_MAP_LABEL_PX = 10;

export function starMapLabelBounds(name: string): {
  width: number;
  height: number;
} {
  return {
    width: estimateTextWidthPx(name, STAR_MAP_LABEL_PX),
    height: lineStepFor(scaledFont(STAR_MAP_LABEL_PX)),
  };
}
