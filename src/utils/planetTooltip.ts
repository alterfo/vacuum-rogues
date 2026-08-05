import { Faction } from "@/types/faction";
import type { Planet } from "@/domain/Planet";
import {
  landingDenialMessage,
  PIRATE_FACTION_ID,
  type LandingDenialReason,
} from "@/systems/galaxy/landingAccess";
import {
  DEFAULT_FACTION_PALETTE,
  factionColor,
} from "@/presentation/ui/palette";

export const FACTION_DISPLAY_NAME: Record<Faction, string> = {
  [Faction.OUTLANDERS]: "Аутсайдеры",
  [Faction.BASTIONS]: "Бастионы",
  [Faction.SYNDICATE]: "Синдикат",
  [Faction.PARADOXES]: "Парадоксы",
  [Faction.PROGRESSORS]: "Прогрессоры",
  [Faction.INDEPENDENT]: "Независимые",
  [Faction.OVERMIND]: "Овермайнд",
};

export const FACTION_COLOR: Record<Faction, number> = DEFAULT_FACTION_PALETTE;

const CAPTURE_FACTIONS: ReadonlySet<Faction> = new Set([Faction.OVERMIND]);

const OCCUPIER_DISPLAY_NAME: Record<string, string> = {
  [PIRATE_FACTION_ID]: "Пираты",
};
const OCCUPIER_COLOR: Record<string, number> = {
  [PIRATE_FACTION_ID]: 0xff4444,
};

export interface CaptureBannerGalaxyView {
  isOvermindSystem?(systemId: string): boolean;
  isPirateSystem?(systemId: string): boolean;
}

export function capturedSystemOccupierName(
  galaxy: CaptureBannerGalaxyView | null | undefined,
  systemId: string | null | undefined,
): string | null {
  if (!galaxy || !systemId) return null;
  if (
    typeof galaxy.isOvermindSystem === "function" &&
    galaxy.isOvermindSystem(systemId)
  ) {
    return FACTION_DISPLAY_NAME[Faction.OVERMIND];
  }
  if (
    typeof galaxy.isPirateSystem === "function" &&
    galaxy.isPirateSystem(systemId)
  ) {
    return OCCUPIER_DISPLAY_NAME[PIRATE_FACTION_ID];
  }
  return null;
}

export function reputationLabel(rep: number): string {
  if (rep >= 50) return "Союзник";
  if (rep >= 20) return "Дружественный";
  if (rep >= -20) return "Нейтральный";
  if (rep >= -50) return "Недовольный";
  return "Враждебный";
}

export function reputationColor(rep: number): number {
  if (rep >= 50) return 0x44dd44;
  if (rep >= 20) return 0x88dd88;
  if (rep >= -20) return 0xcccccc;
  if (rep >= -50) return 0xddaa44;
  return 0xff4444;
}

export interface TooltipLine {
  text: string;
  color: number;
}

export function buildPlanetTooltipLines(
  planet: Pick<Planet, "name" | "isHabitable" | "capturedBy">,
  systemFaction: Faction,
  getReputation: (faction: Faction) => number,
  landingDenial?: LandingDenialReason | null,
): TooltipLine[] {
  const lines: TooltipLine[] = [];

  lines.push({ text: planet.name, color: 0xffffff });

  lines.push(
    planet.isHabitable
      ? { text: "Обитаема", color: 0x44dd44 }
      : { text: "Необитаема", color: 0xaaaaaa },
  );

  const occupier: string | null =
    landingDenial === "overmind"
      ? Faction.OVERMIND
      : landingDenial === "pirate-rep"
        ? PIRATE_FACTION_ID
        : null;
  const controllingFaction = (occupier ??
    (planet.capturedBy as Faction | null | undefined) ??
    systemFaction) as Faction;
  lines.push({
    text:
      FACTION_DISPLAY_NAME[controllingFaction] ??
      OCCUPIER_DISPLAY_NAME[controllingFaction] ??
      controllingFaction,
    color:
      OCCUPIER_COLOR[controllingFaction] ?? factionColor(controllingFaction),
  });

  if (planet.isHabitable) {
    const rep = getReputation(controllingFaction);
    lines.push({ text: reputationLabel(rep), color: reputationColor(rep) });
  }

  if (planet.capturedBy !== null && planet.capturedBy !== undefined) {
    const captor = planet.capturedBy as unknown as Faction;
    const captorName = FACTION_DISPLAY_NAME[captor] ?? planet.capturedBy;
    const verb = CAPTURE_FACTIONS.has(captor) ? "⚠ Захвачена" : "Контроль";
    lines.push({ text: `${verb}: ${captorName}`, color: 0xff4444 });
  }

  if (landingDenial) {
    lines.push({ text: landingDenialMessage(landingDenial), color: 0xff4444 });
  }

  return lines;
}
