import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Container, Text } from "pixi.js";
import {
  CombatHud,
  combatHudPanelLayout,
} from "@/presentation/flight/CombatHud";
import { scaledFont, setFontScale, type FontSizeKey } from "@/utils/fontScale";
import { lineStepFor } from "@/presentation/ui/questCardLayout";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "../../..");
const COMBAT_HUD = resolve(
  PROJECT_ROOT,
  "src/presentation/flight/CombatHud.ts",
);
const PAUSE_OVERLAY = resolve(
  PROJECT_ROOT,
  "src/presentation/flight/CombatPauseOverlay.ts",
);

const HUD_SOURCE = readFileSync(COMBAT_HUD, "utf8");
const PAUSE_SOURCE = readFileSync(PAUSE_OVERLAY, "utf8");

const COMBAT_HUD_PANEL_W = 240;
const COMBAT_HUD_PANEL_MARGIN = 20;

afterEach(() => setFontScale("M"));

function makeSprite(name: string): NpcShipSprite {
  return {
    x: 0,
    y: 0,
    npc: { id: name, name, hullHP: 100, maxHull: 100 },
  } as unknown as NpcShipSprite;
}

function makeHud(): { hud: CombatHud; uiLayer: Container } {
  const uiLayer = new Container();
  const gameLayer = new Container();
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse");
  const hud = new CombatHud(uiLayer, gameLayer, {
    getShipPos: () => ({ x: 100, y: 100 }),
    getScreenSize: () => ({ width: 800, height: 600 }),
    getPlayerLoadout: () => loadout,
  });
  return { hud, uiLayer };
}

function makeHudAt(
  width: number,
  height: number,
): { hud: CombatHud; uiLayer: Container } {
  const uiLayer = new Container();
  const gameLayer = new Container();
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse");
  const hud = new CombatHud(uiLayer, gameLayer, {
    getShipPos: () => ({ x: 100, y: 100 }),
    getScreenSize: () => ({ width, height }),
    getPlayerLoadout: () => loadout,
  });
  return { hud, uiLayer };
}

function panelLabel(uiLayer: Container): Text | undefined {
  for (const child of uiLayer.children) {
    if (child instanceof Container) {
      for (const grandchild of child.children) {
        if (grandchild instanceof Text) return grandchild;
      }
    }
  }
  return undefined;
}

describe("CombatHud / CombatPauseOverlay typography migration (Task 2)", () => {
  it("both files route text through scaledText and keep no raw fontSize:", () => {
    expect(HUD_SOURCE).not.toMatch(/fontSize\s*:/);
    expect(PAUSE_SOURCE).not.toMatch(/fontSize\s*:/);
    expect(HUD_SOURCE).toContain('from "../ui/scaledText"');
    expect(PAUSE_SOURCE).toContain('from "../ui/scaledText"');
    expect(HUD_SOURCE).toContain('scaledText("", LABEL_BASE_PX, 0xffffff');
    expect(PAUSE_SOURCE).toContain("scaledText(text, 16, TITLE_COLOR");
    expect(PAUSE_SOURCE).toContain("scaledText(text, 12, SECTION_COLOR)");
    expect(PAUSE_SOURCE).toContain("scaledText(text, 13, MSG_COLOR");
  });

  it("scales the CombatHud target label with the S/M/L font setting", () => {
    for (const key of ["S", "M", "L"] as FontSizeKey[]) {
      setFontScale(key);
      const { hud, uiLayer } = makeHud();
      hud.open(makeSprite("Пират"));
      const label = panelLabel(uiLayer);
      expect(label).toBeDefined();
      expect(label?.style.fontSize).toBe(scaledFont(13));
      expect(label?.style.fontWeight).toBe("bold");
      expect(label?.style.fill).toBe(0xffffff);
      expect(label?.eventMode).toBe("none");
      hud.close();
    }
  });
});

describe("CombatHud panel layout stays non-overlapping (Task 2)", () => {
  it("keeps the label, bars and panel bottom clear at every font scale", () => {
    for (const key of ["S", "M", "L"] as FontSizeKey[]) {
      setFontScale(key);
      const px = scaledFont(13);
      const layout = combatHudPanelLayout(px);
      expect(layout.labelY + lineStepFor(px)).toBeLessThanOrEqual(
        layout.targetBarY,
      );
      expect(layout.targetBarY).toBeLessThan(layout.playerBarY);
      expect(layout.playerBarY).toBeLessThan(layout.panelHeight);
    }
  });

  it("derives bar steps from the font scale, not fixed offsets", () => {
    setFontScale("S");
    const small = combatHudPanelLayout(scaledFont(13));
    setFontScale("L");
    const large = combatHudPanelLayout(scaledFont(13));
    expect(large.targetBarY).toBeGreaterThan(small.targetBarY);
    expect(large.panelHeight).toBeGreaterThan(small.panelHeight);
  });

  it("keeps the fixed-width panel on screen at phone width", () => {
    const { hud, uiLayer } = makeHudAt(320, 568);
    hud.open(makeSprite("Пират"));
    const panel = uiLayer.children[0] as Container;
    expect(panel.x).toBeGreaterThanOrEqual(COMBAT_HUD_PANEL_MARGIN);
    expect(panel.x + COMBAT_HUD_PANEL_W).toBeLessThanOrEqual(320);
    hud.close();
  });
});
