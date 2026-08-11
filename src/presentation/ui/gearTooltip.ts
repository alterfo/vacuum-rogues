import { Container, Graphics } from "pixi.js";
import { scaledText } from "./scaledText";
import { lineStepFor, estimateTextWidthPx } from "./questCardLayout";
import { scaledFont } from "@/utils/fontScale";
import { formatStat } from "@/utils/formatStat";
import { t } from "@/i18n/i18n";
import { WeaponAbility } from "@/types";
import {
  GearKind,
  EquipmentClass,
  type Gear,
} from "@/systems/equipment/GearCatalog";
import {
  gearStatLine,
  gearComparisonSuffix,
} from "@/systems/equipment/gearDisplay";

const EQUIPMENT_CLASS_KEY: Record<EquipmentClass, string> = {
  [EquipmentClass.ENGINE]: "gearTooltip.class.engine",
  [EquipmentClass.FUEL_TANK]: "gearTooltip.class.fuelTank",
  [EquipmentClass.RADAR]: "gearTooltip.class.radar",
  [EquipmentClass.SCANNER]: "gearTooltip.class.scanner",
  [EquipmentClass.REPAIR_DROID]: "gearTooltip.class.repairDroid",
  [EquipmentClass.GRAPPLE]: "gearTooltip.class.grapple",
  [EquipmentClass.SHIELD]: "gearTooltip.class.shield",
  [EquipmentClass.GRAV_TRACTOR]: "gearTooltip.class.gravTractor",
};

const WEAPON_ABILITY_KEY: Record<WeaponAbility, string> = {
  [WeaponAbility.NONE]: "gearTooltip.ability.none",
  [WeaponAbility.EMP]: "gearTooltip.ability.emp",
  [WeaponAbility.HOMING]: "gearTooltip.ability.homing",
  [WeaponAbility.BURST]: "gearTooltip.ability.burst",
};

const TOOLTIP_FONT_PX = 11;
const TOOLTIP_PADDING = 8;

export function gearTooltipLines(
  gear: Gear,
  replacing?: Gear | null,
): string[] {
  const lines: string[] = [gear.name, gearStatLine(gear)];
  if (gear.kind === GearKind.HULL) {
    lines.push(
      t("gearTooltip.hullSlotsLine", {
        weapon: gear.weaponSlots,
        equipment: gear.equipmentSlots,
        mass: gear.massCapacity,
      }),
    );
  } else if (gear.kind === GearKind.WEAPON) {
    lines.push(
      t("gearTooltip.weaponAbilityLine", {
        ability: t(WEAPON_ABILITY_KEY[gear.ability]),
        cooldown: gear.cooldownTurns,
      }),
    );
  } else {
    lines.push(
      t("gearTooltip.equipmentClassLine", {
        class: t(EQUIPMENT_CLASS_KEY[gear.equipmentClass]),
        potency: formatStat(gear.potency),
      }),
    );
  }
  lines.push(
    t("gearTooltip.techMassLine", { tech: gear.techLevel, mass: gear.mass }),
  );
  if (replacing && replacing.id !== gear.id) {
    lines.push(gearComparisonSuffix(gear, replacing).trim());
  }
  return lines;
}

interface GearTooltipMetrics {
  lines: string[];
  width: number;
  height: number;
}

export function measureGearTooltip(
  gear: Gear,
  replacing?: Gear | null,
): GearTooltipMetrics {
  const lines = gearTooltipLines(gear, replacing);
  const step = lineStepFor(scaledFont(TOOLTIP_FONT_PX));
  const width =
    Math.max(...lines.map((l) => estimateTextWidthPx(l, TOOLTIP_FONT_PX))) +
    TOOLTIP_PADDING * 2;
  const height = lines.length * step + TOOLTIP_PADDING * 2;
  return { lines, width, height };
}

export function mountGearTooltip(
  container: Container,
  gear: Gear,
  x: number,
  y: number,
  opts?: { replacing?: Gear | null; screenW?: number; screenH?: number },
): Container {
  const { lines, width, height } = measureGearTooltip(gear, opts?.replacing);
  const step = lineStepFor(scaledFont(TOOLTIP_FONT_PX));

  const node = new Container();
  node.eventMode = "none";

  const bg = new Graphics();
  bg.roundRect(0, 0, width, height, 4);
  bg.fill({ color: 0x08121e, alpha: 0.92 });
  bg.stroke({ color: 0x335577, width: 1 });
  bg.eventMode = "none";
  node.addChild(bg);

  lines.forEach((line, i) => {
    const lineText = scaledText(
      line,
      TOOLTIP_FONT_PX,
      i === 0 ? 0xffee88 : 0xccddee,
      { rawColor: true, fontWeight: i === 0 ? "bold" : "normal" },
    );
    lineText.eventMode = "none";
    lineText.x = TOOLTIP_PADDING;
    lineText.y = TOOLTIP_PADDING + i * step;
    node.addChild(lineText);
  });

  node.x = opts?.screenW ? Math.min(x, opts.screenW - width - 8) : x;
  node.y = opts?.screenH ? Math.min(y, opts.screenH - height - 8) : y;

  container.addChild(node);
  return node;
}

interface HoverTarget {
  on(event: "pointerover" | "pointerout", fn: () => void): unknown;
}

export function wireGearTooltip(
  target: HoverTarget,
  container: Container,
  gear: Gear,
  x: number,
  y: number,
  opts?: { replacing?: Gear | null; screenW?: number; screenH?: number },
): void {
  let node: Container | null = null;
  target.on("pointerover", () => {
    if (node) return;
    node = mountGearTooltip(container, gear, x, y, opts);
  });
  target.on("pointerout", () => {
    if (!node) return;
    node.destroy({ children: true });
    node = null;
  });
}
