import type { AxialCoord } from "@/types";
import { HexTile } from "./HexTile";

interface PathNode {
  coord: AxialCoord;
  g: number;
  f: number;
  parent: PathNode | null;
}

export class HexGrid {
  readonly tiles: HexTile[][];

  constructor(
    public readonly width: number,
    public readonly height: number,
  ) {
    this.tiles = [];
    for (let r = 0; r < height; r++) {
      const row: HexTile[] = [];
      for (let q = 0; q < width; q++) {
        row.push(new HexTile({ q, r }));
      }
      this.tiles.push(row);
    }
  }

  getTile(coord: AxialCoord): HexTile | undefined {
    if (
      coord.q < 0 ||
      coord.q >= this.width ||
      coord.r < 0 ||
      coord.r >= this.height
    ) {
      return undefined;
    }
    return this.tiles[coord.r][coord.q];
  }

  getNeighbors(coord: AxialCoord): HexTile[] {
    const directions = [
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 },
    ];
    return directions
      .map((d) => this.getTile({ q: coord.q + d.q, r: coord.r + d.r }))
      .filter((t): t is HexTile => t !== undefined);
  }

  findPath(from: AxialCoord, to: AxialCoord): AxialCoord[] | null {
    if (from.q === to.q && from.r === to.r) {
      return [from];
    }

    const fromTile = this.getTile(from);
    const toTile = this.getTile(to);
    if (!fromTile || !toTile) {
      return null;
    }

    const openSet: PathNode[] = [];
    const closedSet = new Set<string>();
    const cameFrom = new Map<string, string>();

    const startKey = `${from.q},${from.r}`;
    const goalKey = `${to.q},${to.r}`;

    openSet.push({
      coord: from,
      g: 0,
      f: this.heuristic(from, to),
      parent: null,
    });

    while (openSet.length > 0) {
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift()!;
      const currentKey = `${current.coord.q},${current.coord.r}`;

      if (currentKey === goalKey) {
        return this.reconstructPath(cameFrom, startKey, goalKey);
      }

      closedSet.add(currentKey);

      for (const neighborTile of this.getNeighbors(current.coord)) {
        const neighborKey = `${neighborTile.coord.q},${neighborTile.coord.r}`;

        if (closedSet.has(neighborKey)) continue;
        if (neighborTile.occupant !== null || neighborTile.type === "ASTEROID")
          continue;

        const tentativeG = current.g + 1;

        const existingNode = openSet.find(
          (n) => `${n.coord.q},${n.coord.r}` === neighborKey,
        );
        if (!existingNode || tentativeG < existingNode.g) {
          const gScore = tentativeG;
          const fScore = gScore + this.heuristic(neighborTile.coord, to);

          const newNode: PathNode = {
            coord: neighborTile.coord,
            g: gScore,
            f: fScore,
            parent: current,
          };

          if (existingNode) {
            const idx = openSet.findIndex(
              (n) => `${n.coord.q},${n.coord.r}` === neighborKey,
            );
            if (idx !== -1) openSet[idx] = newNode;
          } else {
            openSet.push(newNode);
          }

          cameFrom.set(neighborKey, currentKey);
        }
      }
    }

    return null;
  }

  private heuristic(a: AxialCoord, b: AxialCoord): number {
    return (
      (Math.abs(a.q - b.q) +
        Math.abs(a.q + a.r - b.q - b.r) +
        Math.abs(a.r - b.r)) /
      2
    );
  }

  private reconstructPath(
    cameFrom: Map<string, string>,
    startKey: string,
    goalKey: string,
  ): AxialCoord[] {
    const path: AxialCoord[] = [];
    let currentKey = goalKey;

    while (currentKey !== startKey) {
      const [q, r] = currentKey.split(",").map(Number);
      path.push({ q, r });
      const parentKey = cameFrom.get(currentKey);
      if (!parentKey) return []; // Should not happen, return empty path
      currentKey = parentKey;
    }

    const [startQ, startR] = startKey.split(",").map(Number);
    path.push({ q: startQ, r: startR });
    path.reverse();

    return path;
  }
}
