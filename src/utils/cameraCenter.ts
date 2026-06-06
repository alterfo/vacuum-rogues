/** Compute the cameraPan values that centre the ship on screen. */
export function computeCenterOnPlayerPan(
  shipX: number,
  shipY: number,
  screenW: number,
  screenH: number,
  zoom: number,
): { x: number; y: number } {
  return {
    x: screenW / 2 - shipX * zoom,
    y: screenH / 2 - shipY * zoom,
  };
}

/**
 * Returns true when the current camera pan already centres the ship within
 * `threshold` pixels (screen space).  Used to decide whether the ⊙ button
 * should be visible.
 */
export function isCameraOnPlayer(
  cameraPanX: number,
  cameraPanY: number,
  shipX: number,
  shipY: number,
  screenW: number,
  screenH: number,
  zoom: number,
  threshold = 10,
): boolean {
  const expected = computeCenterOnPlayerPan(
    shipX,
    shipY,
    screenW,
    screenH,
    zoom,
  );
  return (
    Math.abs(cameraPanX - expected.x) < threshold &&
    Math.abs(cameraPanY - expected.y) < threshold
  );
}
