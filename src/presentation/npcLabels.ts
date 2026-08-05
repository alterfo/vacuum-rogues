import { NpcRole } from "@/types";
import { t } from "@/i18n/i18n";

export function roleLabel(role: NpcRole): string {
  return t(`role.${role}`);
}

export function npcNameplateTooltip(name: string, role: NpcRole): string {
  return `${name} [${roleLabel(role)}]`;
}
