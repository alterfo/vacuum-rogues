import { describe, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SceneType } from "@/types";
import { RealEngineHarness } from "../realEngineHarness";
import { observe } from "./observe";
import { PlayerAgent } from "./PlayerAgent";
import { MemoryHeuristicPolicy } from "./MemoryHeuristicPolicy";
import type { GameEngine } from "@/systems/GameEngine";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

interface FlightPos {
  shipX: number;
  shipY: number;
  distFromCenter: number;
  boundaryR: number;
  nearestStationDist: number | null;
}

function flightPos(engine: GameEngine): FlightPos | null {
  const scene = engine.currentScene as unknown as {
    shipPhysics?: { shipX: number; shipY: number } | null;
    starRenderer?: { centerX: number; centerY: number };
    SYSTEM_BOUNDARY_RADIUS?: number;
    planetManager?: {
      stationMarkers?: { x: number; y: number }[];
    };
  } | null;
  const phys = scene?.shipPhysics;
  if (!phys || !scene?.starRenderer || scene.SYSTEM_BOUNDARY_RADIUS == null)
    return null;
  const cx = scene.starRenderer.centerX;
  const cy = scene.starRenderer.centerY;
  const dist = Math.hypot(phys.shipX - cx, phys.shipY - cy);
  const markers = scene.planetManager?.stationMarkers ?? [];
  let nearest: number | null = null;
  for (const m of markers) {
    const d = Math.hypot(phys.shipX - m.x, phys.shipY - m.y);
    if (nearest === null || d < nearest) nearest = d;
  }
  return {
    shipX: phys.shipX,
    shipY: phys.shipY,
    distFromCenter: dist,
    boundaryR: scene.SYSTEM_BOUNDARY_RADIUS,
    nearestStationDist: nearest,
  };
}

function combatState(engine: GameEngine): {
  active: boolean;
  planning: boolean;
} {
  const scene = engine.currentScene as unknown as {
    combatModule?: { isActive?: boolean };
    combatPlanning?: { isPlanning?: boolean };
  } | null;
  return {
    active: !!scene?.combatModule?.isActive,
    planning: !!scene?.combatPlanning?.isPlanning,
  };
}

function worldEconomy(engine: GameEngine) {
  const g = engine.galaxy;
  const npcs = g?.npcShips ?? [];
  let npcCredits = 0;
  let npcCargo = 0;
  for (const n of npcs) {
    npcCredits += n.credits ?? 0;
    for (const c of n.cargo ?? []) npcCargo += c.qty ?? 0;
  }
  return {
    day: g?.gameDays ?? 0,
    systems: g?.systems.length ?? 0,
    overmind: g?.overmindSystems.length ?? 0,
    pirate: g?.pirateSystems.length ?? 0,
    npcPop: npcs.length,
    npcCredits,
    npcCargo,
    playerCredits: engine.player?.credits ?? 0,
  };
}

describe.runIf(!!process.env.WORLD_HUNT)(
  "autopilot world + symptom hunt",
  () => {
    it("10 sessions: station-exit spawn, combat stalls, delivery chains, aimless hops, world economy", async () => {
      const SESSIONS = Number(process.env.WORLD_SESSIONS ?? 10);
      const STEPS = Number(process.env.WORLD_STEPS ?? 200);
      const out: unknown[] = [];

      for (let s = 0; s < SESSIONS; s++) {
        const seed = `WORLD-${s}`;
        const harness = await RealEngineHarness.boot({ seed });
        try {
          await harness.newGame();
          const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
          const raw: unknown[] = [];
          const world: unknown[] = [];
          world.push({ at: 0, ...worldEconomy(harness.engine) });
          let prevScene: SceneType | null = null;
          let prevHull = harness.engine.player?.ship?.hullHP ?? 0;

          for (let i = 0; i < STEPS; i++) {
            const engine = harness.engine;
            const obs = observe(engine);
            const pos =
              obs.scene === SceneType.SPACE_FLIGHT ? flightPos(engine) : null;
            const combat = combatState(engine);
            const before = harness.errors().length;
            const res = await agent.run(1);
            const logs = harness
              .errors()
              .slice(before)
              .map((e) => `[${e.source}] ${e.message}`);
            const act = res.steps[0]?.action;
            const hull = obs.player?.hull ?? 0;

            raw.push({
              i,
              day: engine.galaxy?.gameDays ?? 0,
              scene: obs.scene,
              prevScene,
              sys: obs.player?.systemId ?? null,
              cr: obs.player?.credits ?? 0,
              hull,
              maxHull: obs.player?.maxHull ?? 0,
              fuel: Math.round(obs.player?.fuel ?? 0),
              cargo: obs.player?.cargoUsed ?? 0,
              hullDelta: hull - prevHull,
              hostiles: obs.hostiles?.length ?? 0,
              npcs: obs.npcs?.length ?? 0,
              combat: combat.active,
              planning: combat.planning,
              distC: pos ? Math.round(pos.distFromCenter) : null,
              boundR: pos ? Math.round(pos.boundaryR) : null,
              stnDist:
                pos?.nearestStationDist != null
                  ? Math.round(pos.nearestStationDist)
                  : null,
              q: (obs.quests ?? []).map((qq) => ({
                id: qq.id,
                type: qq.type,
                tSys: qq.targetSystemId ?? null,
                tPl: qq.targetPlanetId ?? null,
                carr: qq.collectItem?.carried ?? null,
                req: qq.collectItem?.required ?? null,
              })),
              act: act?.kind ?? "wait",
              tgt: act?.targetId ?? null,
              why: act?.reason ?? null,
              logs,
              wpnDmg: obs.player?.weaponDamage ?? 0,
              bestHull: obs.bestHullPrice ?? null,
              upHull: obs.upgradeHullCost ?? null,
              canArm: obs.canArmUp ?? null,
              armCost: obs.armUpCost ?? null,
              tech: (() => {
                const sys = engine.galaxy?.systems.find(
                  (x) => x.id === (obs.player?.systemId ?? ""),
                );
                return sys?.techLevel ?? null;
              })(),
              omHere: obs.overmindHeldHere ?? false,
            });
            prevScene = obs.scene;
            prevHull = hull;
            if (i % 10 === 9)
              world.push({ at: i + 1, ...worldEconomy(engine) });
            if (
              obs.scene === SceneType.GAME_OVER ||
              obs.scene === SceneType.WIN_SCREEN
            )
              break;
          }
          world.push({ at: raw.length, ...worldEconomy(harness.engine) });
          out.push({
            seed,
            steps: raw.length,
            endScene: harness.currentSceneType(),
            survived: harness.currentSceneType() !== SceneType.GAME_OVER,
            raw,
            world,
          });
        } finally {
          harness.dispose();
        }
      }

      mkdirSync(".letsplay", { recursive: true });
      writeFileSync(
        join(".letsplay", "world-hunt.json"),
        JSON.stringify(out, null, 2),
        "utf8",
      );
      console.log(
        `world-hunt: ${out.length} sessions → .letsplay/world-hunt.json`,
      );
    }, 600_000);
  },
);
