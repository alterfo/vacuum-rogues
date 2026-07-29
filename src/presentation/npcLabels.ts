import { NpcRole } from "@/types";
import { t } from "@/i18n/i18n";

/**
 * Localized NPC role label, e.g. «Рейнджер» / "Ranger". The single source both
 * the contact panel and the in-flight nameplate tooltip read, so a role never
 * leaks its raw enum value (`[TRADER]`) into player-facing text.
 */
export function roleLabel(role: NpcRole): string {
  return t(`role.${role}`);
}

/**
 * The hover-tooltip text for an NPC nameplate: name plus its localized role in
 * brackets, e.g. «Кара [Торговец]» — never the raw `[TRADER]` enum value.
 */
export function npcNameplateTooltip(name: string, role: NpcRole): string {
  return `${name} [${roleLabel(role)}]`;
}
