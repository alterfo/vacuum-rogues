/** Visibility tiers for star map rendering */
export type SystemVisibility = "visited" | "neighbor" | "unknown";

export interface LabelBound {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StarPos {
  x: number;
  y: number;
  r: number;
}

export interface WarpLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Pick the first non-overlapping position for a system name label.
 * Falls back to positions[0] rather than returning null so every explored
 * system always renders its name (prevents unlabelled "dot" systems).
 */
export function pickLabelPosition(
  positions: { x: number; y: number }[],
  labelBounds: LabelBound[],
  starPositions: StarPos[],
  warpLines: WarpLine[],
  labelW: number,
  labelH: number,
): { x: number; y: number } {
  for (const pos of positions) {
    const lx = pos.x;
    const ly = pos.y;

    const overlapsLabel = labelBounds.some(
      (b) =>
        lx < b.x + b.w &&
        lx + labelW > b.x &&
        ly < b.y + b.h &&
        ly + labelH > b.y,
    );
    if (overlapsLabel) continue;

    const overlapsStar = starPositions.some((s) => {
      const nx = Math.max(lx, Math.min(s.x, lx + labelW));
      const ny = Math.max(ly, Math.min(s.y, ly + labelH));
      const dx = s.x - nx;
      const dy = s.y - ny;
      return dx * dx + dy * dy < s.r * s.r;
    });
    if (overlapsStar) continue;

    const intersectsLine = warpLines.some((line) =>
      rectIntersectsLineSegment(
        lx,
        ly,
        labelW,
        labelH,
        line.x1,
        line.y1,
        line.x2,
        line.y2,
      ),
    );
    if (intersectsLine) continue;

    return pos;
  }
  // Fallback: prefer the first candidate over rendering no label at all.
  return positions[0] ?? { x: 0, y: 0 };
}

function rectIntersectsLineSegment(
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  const left = rx,
    right = rx + rw,
    top = ry,
    bottom = ry + rh;
  if ((x1 < left && x2 < left) || (x1 > right && x2 > right)) return false;
  if ((y1 < top && y2 < top) || (y1 > bottom && y2 > bottom)) return false;

  const dx = x2 - x1,
    dy = y2 - y1;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return false;

  const tLeft = dx !== 0 ? (left - x1) / dx : -Infinity;
  const tRight = dx !== 0 ? (right - x1) / dx : Infinity;
  const tTop = dy !== 0 ? (top - y1) / dy : -Infinity;
  const tBottom = dy !== 0 ? (bottom - y1) / dy : Infinity;

  const tMin = Math.max(Math.min(tLeft, tRight), Math.min(tTop, tBottom), 0);
  const tMax = Math.min(Math.max(tLeft, tRight), Math.max(tTop, tBottom), 1);
  return tMin <= tMax;
}

interface SystemRef {
  id: string;
  connections: { toSystemId: string }[];
}

/**
 * Returns the visibility tier for a system on the star map.
 *
 * - visited: player has personally been to this system
 * - neighbor: reachable in 1 jump from any visited system (bidirectional)
 * - unknown: no connection to any visited system
 */
export function getSystemVisibility(
  systemId: string,
  visitedSystemIds: readonly string[],
  allSystems: readonly SystemRef[],
): SystemVisibility {
  const visitedSet = new Set(visitedSystemIds);

  if (visitedSet.has(systemId)) return "visited";

  // Check if any visited system connects to this one, or this one connects to any visited system
  for (const system of allSystems) {
    if (!visitedSet.has(system.id)) continue;
    // visited system → this system
    if (system.connections.some((c) => c.toSystemId === systemId)) {
      return "neighbor";
    }
  }

  // this system → any visited system
  const thisSystem = allSystems.find((s) => s.id === systemId);
  if (thisSystem) {
    for (const conn of thisSystem.connections) {
      if (visitedSet.has(conn.toSystemId)) return "neighbor";
    }
  }

  return "unknown";
}
