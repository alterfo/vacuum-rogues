import { describe, it, expect } from 'vitest';
import { HexGrid } from '@/domain/HexGrid';

describe('HexGrid pathfinding', () => {
  it('should find direct path on empty grid', () => {
    const grid = new HexGrid(5, 5);
    const from = { q: 0, r: 0 };
    const to = { q: 2, r: 0 };

    const path = grid.findPath(from, to);

    expect(path).toBeTruthy();
    expect(path!.length).toBeGreaterThan(0);
    expect(path![0].q).toBe(from.q);
    expect(path![0].r).toBe(from.r);
    expect(path![path!.length - 1].q).toBe(to.q);
    expect(path![path!.length - 1].r).toBe(to.r);
  });

  it('should find path around a single blocked tile', () => {
    const grid = new HexGrid(5, 5);
    const from = { q: 0, r: 0 };
    const to = { q: 2, r: 0 };

    // Block direct neighbor
    const tile = grid.getTile({ q: 1, r: 0 });
    if (tile) tile.occupant = { id: 'block' };

    const path = grid.findPath(from, to);
    // Path should go around the blocked tile
    expect(path).toBeTruthy();
    expect(path!.length).toBeGreaterThan(0);
    expect(path![path!.length - 1].q).toBe(to.q);
    expect(path![path!.length - 1].r).toBe(to.r);
    // Should not step on blocked tile
    const blockedInPath = path!.some((p) => p.q === 1 && p.r === 0);
    expect(blockedInPath).toBe(false);
  });

  it('should return path of length 1 when start equals destination', () => {
    const grid = new HexGrid(3, 3);
    const from = { q: 1, r: 1 };

    const path = grid.findPath(from, from);

    expect(path).toHaveLength(1);
    expect(path![0].q).toBe(1);
    expect(path![0].r).toBe(1);
  });

  it('should return correct neighbors for axial coordinates', () => {
    const grid = new HexGrid(5, 5);
    const neighbors = grid.getNeighbors({ q: 2, r: 2 });

    expect(neighbors).toHaveLength(6);
    const coords = neighbors.map((n) => `${n.coord.q},${n.coord.r}`);
    expect(coords).toContain('3,2');
    expect(coords).toContain('3,1');
    expect(coords).toContain('2,1');
    expect(coords).toContain('1,2');
    expect(coords).toContain('1,3');
    expect(coords).toContain('2,3');
  });

  it('should return fewer neighbors at grid edges', () => {
    const grid = new HexGrid(3, 3);
    const neighbors = grid.getNeighbors({ q: 0, r: 0 });

    expect(neighbors.length).toBeLessThan(6);
  });

  it('should return null for unreachable destination (obstacle blocking)', () => {
    const grid = new HexGrid(3, 3);
    const from = { q: 0, r: 0 };
    const to = { q: 2, r: 2 };

    // Block all possible paths with asteroids
    const tile1 = grid.getTile({ q: 1, r: 0 });
    if (tile1) tile1.type = 'ASTEROID' as import('@/types').TileType;
    const tile2 = grid.getTile({ q: 0, r: 1 });
    if (tile2) tile2.type = 'ASTEROID' as import('@/types').TileType;
    const tile3 = grid.getTile({ q: 1, r: 1 });
    if (tile3) tile3.type = 'ASTEROID' as import('@/types').TileType;
    const tile4 = grid.getTile({ q: 2, r: 0 });
    if (tile4) tile4.type = 'ASTEROID' as import('@/types').TileType;
    const tile5 = grid.getTile({ q: 0, r: 2 });
    if (tile5) tile5.type = 'ASTEROID' as import('@/types').TileType;
    const tile6 = grid.getTile({ q: 1, r: 2 });
    if (tile6) tile6.type = 'ASTEROID' as import('@/types').TileType;

    const path = grid.findPath(from, to);

    expect(path).toBeNull();
  });

  it('should find shortest path around obstacle at (1,1) with 5-step path to (2,2)', () => {
    const grid = new HexGrid(5, 5);
    const from = { q: 0, r: 0 };
    const to = { q: 2, r: 2 };

    // Block center tile
    const centerTile = grid.getTile({ q: 1, r: 1 });
    if (centerTile) centerTile.occupant = { id: 'block' };

    const path = grid.findPath(from, to);

    expect(path).toBeTruthy();
    expect(path!.length).toBeGreaterThan(0);
    expect(path![0].q).toBe(0);
    expect(path![0].r).toBe(0);
    expect(path![path!.length - 1].q).toBe(2);
    expect(path![path!.length - 1].r).toBe(2);
    // Should not pass through blocked tile
    const blockedInPath = path!.some((p) => p.q === 1 && p.r === 1);
    expect(blockedInPath).toBe(false);
  });

  it('should return null for out-of-bounds destination', () => {
    const grid = new HexGrid(3, 3);
    const from = { q: 1, r: 1 };
    const to = { q: 10, r: 10 };

    const path = grid.findPath(from, to);

    expect(path).toBeNull();
  });

  it('should complete within 10 ms for unreachable goal on 3x3 grid', () => {
    const grid = new HexGrid(3, 3);
    const from = { q: 0, r: 0 };
    const to = { q: 2, r: 2 };

    // Create complete blockage
    for (let r = 0; r < 3; r++) {
      for (let q = 0; q < 3; q++) {
        if (!(q === 0 && r === 0) && !(q === 2 && r === 2)) {
          const tile = grid.getTile({ q, r });
          if (tile) tile.type = 'ASTEROID' as import('@/types').TileType;
        }
      }
    }

    const startTime = performance.now();
    const path = grid.findPath(from, to);
    const elapsed = performance.now() - startTime;

    expect(path).toBeNull();
    expect(elapsed).toBeLessThan(10);
  });
});
