import { describe, it, expect } from "vitest";
import {
  advanceLevel,
  createArcadeRun,
  damagePlayer,
  tick,
} from "@/systems/blackHoleArcade/arcadeState";
import * as cfg from "@/systems/blackHoleArcade/arcadeConfig";
import { makeBullet } from "@/systems/blackHoleArcade/arcadeBullets";
import {
  arcadeLevelReward,
  arcadeReward,
  arcadeRunReward,
} from "@/systems/blackHoleArcade/arcadeRewards";
import { addEnemy, fire, holdRun, IDLE } from "./arcadeHelpers";

function enemyShot(
  state: ReturnType<typeof holdRun>,
  x: number,
  y: number,
  damage = 10,
) {
  state.enemyBullets.push(
    makeBullet(state.nextId++, {
      owner: "enemy",
      kind: "enemyOrb",
      x,
      y,
      vx: 0,
      vy: 0,
      radius: 6,
      damage,
    }),
  );
}

describe("arcade player control", () => {
  it("the mouse target is reached instantly, with no easing lag", () => {
    const s = holdRun();
    tick(s, { ...IDLE, targetX: 100, targetY: 500 }, 16);
    expect(s.player.x).toBe(100);
    expect(s.player.y).toBe(500);
    tick(s, { ...IDLE, targetX: 600, targetY: 300 }, 16);
    expect(s.player.x).toBe(600);
    expect(s.player.y).toBe(300);
  });

  it("targets outside the field are clamped to the margins", () => {
    const s = holdRun();
    tick(s, { ...IDLE, targetX: -500, targetY: 99999 }, 16);
    expect(s.player.x).toBe(cfg.ARCADE_PLAYER_MARGIN);
    expect(s.player.y).toBe(cfg.ARCADE_FIELD_H - cfg.ARCADE_PLAYER_MARGIN);
  });

  it("a fast flick through a bullet still gets hit", () => {
    const s = holdRun();
    s.player.x = 100;
    s.player.y = 900;
    enemyShot(s, 360, 900, 10);
    tick(s, { ...IDLE, targetX: 100, targetY: 900 }, 16);
    expect(s.player.hull).toBe(100);
    tick(s, { ...IDLE, targetX: 620, targetY: 900 }, 16);
    expect(s.player.hull).toBe(90);
  });

  it("a very long frame is capped so the ship cannot teleport through hazards", () => {
    const s = holdRun();
    const before = s.levelTimeMs;
    tick(s, IDLE, 5000);
    expect(s.levelTimeMs - before).toBeLessThanOrEqual(
      cfg.ARCADE_MAX_FRAME_MS + 1e-6,
    );
  });

  it("the keyboard moves at a fixed speed, diagonals not faster", () => {
    const s = holdRun();
    const x0 = s.player.x;
    const y0 = s.player.y;
    tick(s, { ...IDLE, moveX: 1, moveY: -1 }, 100);
    const dist = Math.hypot(s.player.x - x0, s.player.y - y0);
    expect(dist).toBeCloseTo(cfg.ARCADE_PLAYER_KEY_SPEED * 0.1, 0);
  });

  it("does not fire unless asked, and respects the weapon cooldown", () => {
    const s = holdRun();
    tick(s, IDLE, 16);
    expect(s.playerBullets).toHaveLength(0);
    tick(s, fire(), 16);
    expect(s.playerBullets).toHaveLength(1);
    tick(s, fire(), 16);
    expect(s.playerBullets.filter((b) => b.kind === "pulse")).toHaveLength(1);
    for (let i = 0; i < 10; i++) tick(s, fire(), 16);
    expect(s.playerBullets.length).toBeGreaterThan(1);
  });

  it("wingmen add their own stream of bullets", () => {
    const s = holdRun();
    s.player.drones = 2;
    tick(s, fire(), 16);
    expect(s.playerBullets.filter((b) => b.kind === "drone")).toHaveLength(2);
  });

  it("events reset each tick", () => {
    const s = holdRun();
    s.events.push({ kind: "bossDown" });
    tick(s, IDLE, 16);
    expect(s.events.some((e) => e.kind === "bossDown")).toBe(false);
  });
});

describe("arcade damage model", () => {
  it("shield soaks first, then armor trims what reaches the hull", () => {
    const s = holdRun();
    s.player.shield = 30;
    s.player.shieldMax = 40;
    s.player.armor = 0.5;
    damagePlayer(s, 50);
    expect(s.player.shield).toBe(0);
    expect(s.player.hull).toBeCloseTo(100 - 20 * 0.5, 5);
  });

  it("a fully shielded hit leaves the hull alone and is flagged as shielded", () => {
    const s = holdRun();
    s.player.shield = 40;
    s.player.shieldMax = 40;
    damagePlayer(s, 15);
    expect(s.player.hull).toBe(100);
    expect(s.player.shield).toBe(25);
    expect(s.events.at(-1)).toEqual({ kind: "playerHit", shielded: true });
  });

  it("invulnerability frames block back-to-back hits", () => {
    const s = holdRun();
    damagePlayer(s, 10);
    damagePlayer(s, 10);
    expect(s.player.hull).toBe(90);
    for (let i = 0; i < 40; i++) tick(s, IDLE, 16);
    damagePlayer(s, 10);
    expect(s.player.hull).toBe(80);
  });

  it("the shield recharges after a quiet spell, but not while being hit", () => {
    const s = holdRun();
    s.player.shield = 10;
    s.player.shieldMax = 40;
    s.player.shieldRegenDelayMs = cfg.ARCADE_SHIELD_REGEN_DELAY_MS;
    for (let i = 0; i < 60; i++) tick(s, IDLE, 16);
    expect(s.player.shield).toBe(10);
    for (let i = 0; i < 300; i++) tick(s, IDLE, 16);
    expect(s.player.shield).toBeGreaterThan(20);
  });

  it("an enemy bullet that reaches the ship hurts it and is consumed", () => {
    const s = holdRun();
    enemyShot(s, s.player.x, s.player.y, 12);
    tick(s, IDLE, 16);
    expect(s.player.hull).toBe(88);
    expect(s.enemyBullets).toHaveLength(0);
  });

  it("bullets that miss pass by; stray bullets leave the field and are dropped", () => {
    const s = holdRun();
    enemyShot(s, s.player.x + 200, s.player.y);
    s.enemyBullets[0].vy = 2000;
    for (let i = 0; i < 60; i++) tick(s, IDLE, 16);
    expect(s.player.hull).toBe(100);
    expect(s.enemyBullets).toHaveLength(0);
  });

  it("ramming an air enemy hurts both, once per invulnerability window", () => {
    const s = holdRun();
    const e = addEnemy(s, "armored", s.player.x, s.player.y);
    const hp0 = e.hp;
    tick(s, IDLE, 16);
    expect(s.player.hull).toBeLessThan(100);
    expect(e.hp).toBe(hp0 - 15 > 0 && e.isBoss ? hp0 - 15 : hp0 - 40);
    const hullAfter = s.player.hull;
    tick(s, IDLE, 16);
    expect(s.player.hull).toBe(hullAfter);
  });

  it("ground units cannot be rammed", () => {
    const s = holdRun();
    addEnemy(s, "turret", s.player.x, s.player.y);
    tick(s, IDLE, 16);
    expect(s.player.hull).toBe(100);
  });

  it("zero hull ends the run and freezes the world", () => {
    const s = holdRun();
    s.player.hull = 5;
    damagePlayer(s, 50);
    expect(s.phase).toBe("lost");
    const t = s.levelTimeMs;
    tick(s, IDLE, 500);
    expect(s.levelTimeMs).toBe(t);
  });
});

describe("arcade shooting", () => {
  it("bullets damage and destroy enemies, awarding score and a guaranteed drop", () => {
    const s = holdRun();
    const e = addEnemy(s, "scout", 360, 400, { drop: "shield" });
    e.hp = 5;
    s.playerBullets.push(
      makeBullet(s.nextId++, {
        owner: "player",
        kind: "pulse",
        x: 360,
        y: 400,
        vx: 0,
        vy: 0,
        radius: 5,
        damage: 10,
      }),
    );
    tick(s, IDLE, 16);
    expect(s.enemies).toHaveLength(0);
    expect(s.kills).toBe(1);
    expect(s.score).toBeGreaterThan(0);
    expect(s.pickups.map((p) => p.kind)).toEqual(["shield"]);
    expect(s.events.some((ev) => ev.kind === "explosion")).toBe(true);
  });

  it("a laser bolt pierces through several enemies in a line", () => {
    const s = holdRun();
    const hp = 200;
    const a = addEnemy(s, "armored", 360, 600, { hp, maxHp: hp });
    const b = addEnemy(s, "armored", 360, 560, { hp, maxHp: hp });
    s.playerBullets.push(
      makeBullet(s.nextId++, {
        owner: "player",
        kind: "laser",
        x: 360,
        y: 640,
        vx: 0,
        vy: -2100,
        radius: 4,
        damage: 20,
        pierce: 3,
      }),
    );
    for (let i = 0; i < 8; i++) tick(s, IDLE, 16);
    expect(a.hp).toBeLessThan(hp);
    expect(b.hp).toBeLessThan(hp);
  });

  it("a plasma ball splashes enemies around the impact", () => {
    const s = holdRun();
    const hit = addEnemy(s, "armored", 360, 500, { hp: 500, maxHp: 500 });
    const near = addEnemy(s, "armored", 420, 500, { hp: 500, maxHp: 500 });
    const far = addEnemy(s, "armored", 600, 500, { hp: 500, maxHp: 500 });
    s.playerBullets.push(
      makeBullet(s.nextId++, {
        owner: "player",
        kind: "plasma",
        x: 360,
        y: 500,
        vx: 0,
        vy: 0,
        radius: 15,
        damage: 50,
        blast: 100,
      }),
    );
    tick(s, IDLE, 16);
    expect(hit.hp).toBeLessThan(500);
    expect(near.hp).toBeLessThan(500);
    expect(far.hp).toBe(500);
    expect(s.events.some((ev) => ev.kind === "blast")).toBe(true);
  });

  it("homing missiles curve toward an enemy off to the side and hit it", () => {
    const s = holdRun();
    const e = addEnemy(s, "armored", 600, 400, { hp: 500, maxHp: 500, vy: 0 });
    e.vx = 0;
    s.playerBullets.push(
      makeBullet(s.nextId++, {
        owner: "player",
        kind: "missile",
        x: 360,
        y: 700,
        vx: 0,
        vy: -620,
        radius: 7,
        damage: 30,
        ttlMs: 4000,
        homingTurn: 5.5,
        blast: 36,
      }),
    );
    for (let i = 0; i < 120 && e.hp === 500; i++) tick(s, IDLE, 16);
    expect(e.hp).toBeLessThan(500);
  });

  it("wave bullets sweep sideways", () => {
    const s = holdRun();
    s.player.weapon = "wave";
    tick(s, fire(), 16);
    const xs = new Set<number>();
    for (let i = 0; i < 30; i++) {
      tick(s, IDLE, 16);
      for (const b of s.playerBullets) xs.add(Math.round(b.x));
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(30);
  });

  it("the arc weapon damages chained enemies instantly and reports its path", () => {
    const s = holdRun();
    s.player.weapon = "arc";
    s.player.x = 360;
    s.player.y = 900;
    const a = addEnemy(s, "armored", 360, 700, { hp: 500, maxHp: 500 });
    const b = addEnemy(s, "armored", 420, 600, { hp: 500, maxHp: 500 });
    tick(s, fire(), 16);
    expect(a.hp).toBeLessThan(500);
    expect(b.hp).toBeLessThan(500);
    expect(s.events.some((ev) => ev.kind === "arc")).toBe(true);
  });
});

describe("arcade pickups in play", () => {
  it("flying into a pickup collects it", () => {
    const s = holdRun();
    s.pickups.push({
      id: s.nextId++,
      kind: "bomb",
      x: s.player.x,
      y: s.player.y,
      radius: 18,
      ageMs: 0,
    });
    const bombs = s.player.bombs;
    tick(s, IDLE, 16);
    expect(s.player.bombs).toBe(bombs + 1);
    expect(s.pickups).toHaveLength(0);
    expect(s.events.some((e) => e.kind === "pickup")).toBe(true);
  });

  it("uncollected pickups drift down and vanish off the bottom", () => {
    const s = holdRun();
    s.player.x = 50;
    s.pickups.push({
      id: s.nextId++,
      kind: "bomb",
      x: 600,
      y: cfg.ARCADE_FIELD_H - 10,
      radius: 18,
      ageMs: 0,
    });
    for (let i = 0; i < 90; i++) tick(s, IDLE, 16);
    expect(s.pickups).toHaveLength(0);
  });

  it("the magnet pulls pickups in from across the screen", () => {
    const s = holdRun();
    s.player.magnetMs = 5000;
    s.player.x = 100;
    s.player.y = 900;
    s.pickups.push({
      id: s.nextId++,
      kind: "chip",
      x: 650,
      y: 200,
      radius: 18,
      ageMs: 0,
    });
    for (let i = 0; i < 100 && s.pickups.length > 0; i++) tick(s, IDLE, 16);
    expect(s.pickups).toHaveLength(0);
    expect(s.chipCredits).toBeGreaterThan(0);
  });

  it("collected chips add to the run's reward pool", () => {
    const s = holdRun({ startLevel: 10 });
    s.pickups.push({
      id: s.nextId++,
      kind: "chip",
      x: s.player.x,
      y: s.player.y,
      radius: 18,
      ageMs: 0,
    });
    tick(s, IDLE, 16);
    expect(s.chipCredits).toBe(125);
  });
});

describe("arcade bomb", () => {
  it("spends a bomb, wipes enemy bullets, damages everything and shields the ship", () => {
    const s = holdRun();
    const e = addEnemy(s, "gunship", 360, 300, { hp: 90, maxHp: 90 });
    enemyShot(s, 360, 500);
    const bombs = s.player.bombs;
    tick(s, { ...IDLE, bomb: true }, 16);
    expect(s.player.bombs).toBe(bombs - 1);
    expect(s.enemyBullets).toHaveLength(0);
    expect(e.hp).toBeLessThan(90);
    expect(s.events.some((ev) => ev.kind === "bombStart")).toBe(true);
    enemyShot(s, s.player.x, s.player.y, 40);
    tick(s, IDLE, 16);
    expect(s.player.hull).toBe(100);
    for (let i = 0; i < 20; i++) tick(s, IDLE, 100);
    expect(e.hp).toBeLessThanOrEqual(0);
  });

  it("bosses resist the bomb", () => {
    const s = holdRun();
    const e = addEnemy(s, "gunship", 360, 300, { hp: 1000, maxHp: 1000 });
    const boss = addEnemy(s, "cruiser", 200, 300, { hp: 1000, maxHp: 1000 });
    tick(s, { ...IDLE, bomb: true }, 100);
    expect(1000 - boss.hp).toBeLessThan(1000 - e.hp);
  });

  it("does nothing with no bombs left or while one is already running", () => {
    const s = holdRun();
    s.player.bombs = 0;
    tick(s, { ...IDLE, bomb: true }, 16);
    expect(s.bombFxMs).toBe(0);
    s.player.bombs = 2;
    tick(s, { ...IDLE, bomb: true }, 16);
    tick(s, { ...IDLE, bomb: true }, 16);
    expect(s.player.bombs).toBe(1);
  });

  it("one press during a multi-step frame is spent only once", () => {
    const s = holdRun();
    tick(s, { ...IDLE, bomb: true }, 100);
    expect(s.player.bombs).toBe(cfg.ARCADE_PLAYER_START_BOMBS - 1);
  });
});

describe("arcade bosses", () => {
  it("killing one drops a full set of rewards and clears the bullets", () => {
    const s = holdRun({ startLevel: 10 });
    const boss = addEnemy(s, "boss", 360, 200, { hp: 1, maxHp: 100 });
    enemyShot(s, 100, 100);
    s.playerBullets.push(
      makeBullet(s.nextId++, {
        owner: "player",
        kind: "pulse",
        x: 360,
        y: 200,
        vx: 0,
        vy: 0,
        radius: 5,
        damage: 50,
      }),
    );
    tick(s, IDLE, 16);
    expect(boss.hp).toBeLessThanOrEqual(0);
    expect(s.enemies).toHaveLength(0);
    expect(s.enemyBullets).toHaveLength(0);
    expect(s.pickups.length).toBeGreaterThanOrEqual(6);
    expect(s.events.some((e) => e.kind === "bossDown")).toBe(true);
  });
});

describe("arcade level flow", () => {
  it("an exhausted level with no enemies left is cleared, then moves to an intermission", () => {
    const s = createArcadeRun({ seed: 1 });
    s.plan = { ...s.plan, spawns: [] };
    tick(s, IDLE, 16);
    expect(s.phase).toBe("levelClear");
    expect(s.levelsCleared).toBe(1);
    expect(s.events.some((e) => e.kind === "levelClear")).toBe(true);
    for (let i = 0; i < 40; i++) tick(s, IDLE, 100);
    expect(s.phase).toBe("intermission");
  });

  it("the player keeps control and can still collect during the clear banner", () => {
    const s = createArcadeRun({ seed: 1 });
    s.plan = { ...s.plan, spawns: [] };
    tick(s, IDLE, 16);
    tick(s, { ...IDLE, targetX: 200, targetY: 400 }, 16);
    expect(s.player.x).toBe(200);
  });

  it("advancing builds the next level, heals a bit and clears the field", () => {
    const s = createArcadeRun({ seed: 1 });
    s.plan = { ...s.plan, spawns: [] };
    tick(s, IDLE, 16);
    for (let i = 0; i < 40; i++) tick(s, IDLE, 100);
    s.player.hull = 50;
    enemyShot(s, 10, 10);
    expect(advanceLevel(s)).toBe(true);
    expect(s.level).toBe(2);
    expect(s.phase).toBe("playing");
    expect(s.plan.level).toBe(2);
    expect(s.nextSpawnIndex).toBe(0);
    expect(s.levelTimeMs).toBe(0);
    expect(s.player.hull).toBe(50 + cfg.ARCADE_LEVEL_CLEAR_HEAL);
    expect(s.enemyBullets).toHaveLength(0);
    expect(s.player.invulnMs).toBeGreaterThan(0);
  });

  it("cannot advance unless in the intermission", () => {
    const s = createArcadeRun({ seed: 1 });
    expect(advanceLevel(s)).toBe(false);
    expect(s.level).toBe(1);
  });

  it("clearing the final level wins the run", () => {
    const s = createArcadeRun({ seed: 1, startLevel: 50 });
    s.plan = { ...s.plan, spawns: [] };
    tick(s, IDLE, 16);
    expect(s.levelsCleared).toBe(50);
    for (let i = 0; i < 40; i++) tick(s, IDLE, 100);
    expect(s.phase).toBe("won");
  });

  it("starting at a later level counts earlier levels as already cleared", () => {
    expect(createArcadeRun({ startLevel: 12 }).levelsCleared).toBe(11);
    expect(createArcadeRun({ startLevel: 500 }).level).toBe(50);
  });

  it("spawns enemies on schedule and they scroll into play", () => {
    const s = createArcadeRun({ seed: 2 });
    for (let i = 0; i < 200; i++) tick(s, IDLE, 16);
    expect(s.enemies.length).toBeGreaterThan(0);
  });
});

describe("arcade rewards", () => {
  it("each level pays more than the last", () => {
    for (let l = 2; l <= 50; l++) {
      expect(arcadeLevelReward(l)).toBeGreaterThan(arcadeLevelReward(l - 1));
    }
  });

  it("nothing cleared pays nothing but chips", () => {
    expect(arcadeReward(0, 0, "lost")).toBe(0);
    expect(arcadeReward(0, 80, "lost")).toBe(80);
  });

  it("defeat and retreat pay half the level money, cashing out and winning pay all of it", () => {
    const full = arcadeReward(10, 0, "cashOut");
    expect(arcadeReward(10, 0, "lost")).toBe(Math.round(full / 2));
    expect(arcadeReward(10, 0, "retreat")).toBe(Math.round(full / 2));
    expect(arcadeReward(50, 0, "won")).toBeGreaterThan(
      arcadeReward(50, 0, "cashOut"),
    );
  });

  it("chips are paid in full whatever the ending", () => {
    expect(arcadeReward(5, 500, "lost") - arcadeReward(5, 0, "lost")).toBe(500);
  });

  it("is monotonic in levels cleared and always whole credits", () => {
    let prev = -1;
    for (let l = 0; l <= 50; l++) {
      const r = arcadeReward(l, 33, "cashOut");
      expect(Number.isInteger(r)).toBe(true);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  });

  it("reads straight from a run", () => {
    const s = createArcadeRun({ startLevel: 4 });
    s.chipCredits = 100;
    expect(arcadeRunReward(s, "cashOut")).toBe(arcadeReward(3, 100, "cashOut"));
  });
});

describe("arcade run difficulty", () => {
  it("a tougher run spawns tougher enemies and hits harder", () => {
    const easy = createArcadeRun({ seed: 4, difficulty: 1 });
    const hard = createArcadeRun({ seed: 4, difficulty: 1.2 });
    for (const s of [easy, hard])
      for (let i = 0; i < 400; i++) tick(s, IDLE, 16);
    expect(hard.enemies.length).toBeGreaterThan(0);
    expect(hard.enemies[0].maxHp).toBeGreaterThan(easy.enemies[0].maxHp);
  });

  it("never goes below the base difficulty", () => {
    expect(createArcadeRun({ difficulty: 0.2 }).difficulty).toBe(1);
    expect(createArcadeRun().difficulty).toBe(1);
  });
});

describe("arcade determinism", () => {
  it("the same seed and inputs always give the same run", () => {
    const play = () => {
      const s = createArcadeRun({ seed: 99 });
      for (let i = 0; i < 900; i++) {
        tick(
          s,
          { ...fire(), targetX: 360 + Math.sin(i / 20) * 250, targetY: 900 },
          16,
        );
      }
      return JSON.stringify({ ...s, events: [] });
    };
    expect(play()).toBe(play());
  });
});
