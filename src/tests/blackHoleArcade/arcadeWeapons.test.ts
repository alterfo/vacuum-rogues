import { describe, it, expect } from "vitest";
import {
  ARCADE_WEAPONS,
  fireWeapon,
  weaponInterval,
} from "@/systems/blackHoleArcade/arcadeWeapons";
import { ARCADE_WEAPON_IDS } from "@/systems/blackHoleArcade/arcadeTypes";
import { createArcadeRun } from "@/systems/blackHoleArcade/arcadeState";
import { addEnemy } from "./arcadeHelpers";

describe("arcade weapons", () => {
  it("has six distinct weapons with distinct colors", () => {
    expect(ARCADE_WEAPON_IDS).toHaveLength(6);
    const colors = new Set(
      ARCADE_WEAPON_IDS.map((id) => ARCADE_WEAPONS[id].color),
    );
    expect(colors.size).toBe(6);
  });

  it("vulcan widens its fan with each level, symmetric around the nose", () => {
    for (let level = 1; level <= 5; level++) {
      const { bullets } = fireWeapon("vulcan", level, 360, 900, []);
      expect(bullets).toHaveLength(level);
      const sumVx = bullets.reduce((a, b) => a + b.vx, 0);
      expect(Math.abs(sumVx)).toBeLessThan(1e-6);
      expect(bullets.every((b) => b.vy < 0)).toBe(true);
    }
    const wide = fireWeapon("vulcan", 5, 360, 900, []).bullets;
    expect(Math.min(...wide.map((b) => b.vx))).toBeLessThan(-500);
  });

  it("laser adds parallel lanes and more piercing per level", () => {
    for (let level = 1; level <= 5; level++) {
      const { bullets } = fireWeapon("laser", level, 360, 900, []);
      expect(bullets).toHaveLength(level);
      expect(bullets.every((b) => b.pierce === level + 1)).toBe(true);
      expect(bullets.every((b) => b.vx === 0 && b.vy < -1500)).toBe(true);
    }
    const l1 = fireWeapon("laser", 1, 0, 0, []).bullets[0].damage;
    const l5 = fireWeapon("laser", 5, 0, 0, []).bullets[0].damage;
    expect(l5).toBeGreaterThan(l1);
  });

  it("homing launches missiles that seek, plus a small straight pulse", () => {
    const { bullets } = fireWeapon("homing", 3, 360, 900, []);
    const missiles = bullets.filter((b) => b.kind === "missile");
    expect(missiles).toHaveLength(6);
    expect(
      missiles.every((m) => (m.homingTurn ?? 0) > 0 && (m.blast ?? 0) > 0),
    ).toBe(true);
    expect(bullets.filter((b) => b.kind === "pulse")).toHaveLength(1);
  });

  it("homing missiles hit moderately: damage and splash are kept modest", () => {
    const damage = (level: number) =>
      fireWeapon("homing", level, 0, 0, []).bullets.find(
        (b) => b.kind === "missile",
      )!.damage;
    expect(damage(1)).toBe(18);
    expect(damage(5)).toBe(26);
    const blast =
      fireWeapon("homing", 3, 0, 0, []).bullets.find(
        (b) => b.kind === "missile",
      )!.blast ?? 0;
    expect(blast).toBe(30);
  });

  it("wave fires mirrored sine pairs", () => {
    const l1 = fireWeapon("wave", 1, 360, 900, []).bullets;
    expect(l1).toHaveLength(2);
    expect(l1[0].wavePhase).toBe(0);
    expect(l1[1].wavePhase).toBeCloseTo(Math.PI);
    expect(fireWeapon("wave", 5, 360, 900, []).bullets).toHaveLength(6);
  });

  it("plasma grows blast radius and ball count with level", () => {
    expect(fireWeapon("plasma", 1, 0, 0, []).bullets).toHaveLength(1);
    expect(fireWeapon("plasma", 2, 0, 0, []).bullets).toHaveLength(2);
    expect(fireWeapon("plasma", 4, 0, 0, []).bullets).toHaveLength(3);
    const b1 = fireWeapon("plasma", 1, 0, 0, []).bullets[0].blast ?? 0;
    const b5 = fireWeapon("plasma", 5, 0, 0, []).bullets[0].blast ?? 0;
    expect(b5).toBeGreaterThan(b1);
  });

  it("arc chains instantly through nearby enemies ahead, up to the level's chain length", () => {
    const state = createArcadeRun({ seed: 3 });
    const e1 = addEnemy(state, "scout", 360, 700);
    const e2 = addEnemy(state, "scout", 400, 600);
    const e3 = addEnemy(state, "scout", 440, 520);
    const e4 = addEnemy(state, "scout", 470, 450);
    const behind = addEnemy(state, "scout", 360, 950);
    const result = fireWeapon("arc", 1, 360, 880, state.enemies);
    expect(result.bullets).toHaveLength(0);
    expect(result.arcTargets.map((t) => t.enemyId)).toEqual([e1.id, e2.id]);
    expect(result.arcPoints.length).toBe(3);

    const l3 = fireWeapon("arc", 3, 360, 880, state.enemies);
    expect(l3.arcTargets.map((t) => t.enemyId)).toEqual([
      e1.id,
      e2.id,
      e3.id,
      e4.id,
    ]);
    expect(l3.arcTargets.some((t) => t.enemyId === behind.id)).toBe(false);
  });

  it("arc with nothing in range does nothing", () => {
    const result = fireWeapon("arc", 5, 360, 880, []);
    expect(result.arcTargets).toEqual([]);
    expect(result.arcPoints).toEqual([]);
  });

  it("clamps absurd levels and defines positive intervals", () => {
    expect(fireWeapon("vulcan", 99, 0, 0, []).bullets).toHaveLength(5);
    expect(fireWeapon("vulcan", -3, 0, 0, []).bullets).toHaveLength(1);
    for (const id of ARCADE_WEAPON_IDS) {
      expect(weaponInterval(id, 1)).toBeGreaterThan(0);
    }
  });
});
