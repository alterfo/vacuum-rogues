import { Faction } from "@/types/faction";
import type { Planet } from "@/domain/Planet";

/** Display names for factions shown in planet tooltips. */
export const FACTION_DISPLAY_NAME: Record<Faction, string> = {
  [Faction.OUTLANDERS]: "Аутсайдеры",
  [Faction.BASTIONS]: "Бастионы",
  [Faction.SYNDICATE]: "Синдикат",
  [Faction.PARADOXES]: "Парадоксы",
  [Faction.PROGRESSORS]: "Прогрессоры",
  [Faction.INDEPENDENT]: "Независимые",
  [Faction.OVERMIND]: "Овермайнд",
};

/** Banner / hull colour per faction (shared with ship sprites). */
export const FACTION_COLOR: Record<Faction, number> = {
  [Faction.OUTLANDERS]: 0xff6600,
  [Faction.BASTIONS]: 0xcc0000,
  [Faction.SYNDICATE]: 0x00ff00,
  [Faction.PARADOXES]: 0x9900ff,
  [Faction.PROGRESSORS]: 0x0066ff,
  [Faction.INDEPENDENT]: 0x999999,
  [Faction.OVERMIND]: 0xff33dd,
};

/** Hostile factions that "capture" planets — flagged in red on the tooltip. */
const CAPTURE_FACTIONS: ReadonlySet<Faction> = new Set([Faction.OVERMIND]);

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

/**
 * Build the ordered lines of a planet hover tooltip:
 *   1. planet name (white)
 *   2. habitability (green / grey)
 *   3. controlling faction name — in faction colour
 *   4. player relation to that faction (Союзник / Нейтральный / Враждебный…)
 *   5. capture warning, in red, only when the planet is captured
 *
 * The controlling faction is the captor when the planet is captured, otherwise
 * the system's owning faction. Reputation is looked up against the controlling
 * faction so the relation line tracks who actually holds the planet.
 */
export function buildPlanetTooltipLines(
  planet: Pick<Planet, "name" | "isHabitable" | "capturedBy">,
  systemFaction: Faction,
  getReputation: (faction: Faction) => number,
): TooltipLine[] {
  const lines: TooltipLine[] = [];

  // 1. Name.
  lines.push({ text: planet.name, color: 0xffffff });

  // 2. Habitability.
  lines.push(
    planet.isHabitable
      ? { text: "Обитаема", color: 0x44dd44 }
      : { text: "Необитаема", color: 0xaaaaaa },
  );

  // 3. Controlling faction (capture-aware) name in faction colour.
  const controllingFaction =
    (planet.capturedBy as Faction | null | undefined) ?? systemFaction;
  lines.push({
    text: FACTION_DISPLAY_NAME[controllingFaction] ?? controllingFaction,
    color: FACTION_COLOR[controllingFaction] ?? 0x999999,
  });

  // 4. Player relation to the controlling faction.
  const rep = getReputation(controllingFaction);
  lines.push({ text: reputationLabel(rep), color: reputationColor(rep) });

  // 5. Capture warning (red) — explicit when seized by a hostile faction.
  if (planet.capturedBy !== null && planet.capturedBy !== undefined) {
    const captor = planet.capturedBy as unknown as Faction;
    const captorName = FACTION_DISPLAY_NAME[captor] ?? planet.capturedBy;
    const verb = CAPTURE_FACTIONS.has(captor) ? "⚠ Захвачена" : "Контроль";
    lines.push({ text: `${verb}: ${captorName}`, color: 0xff4444 });
  }

  return lines;
}
