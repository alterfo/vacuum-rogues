import type { Galaxy } from "@/domain/Galaxy";
import type { Player } from "@/domain/Player";
import { describeRumor, rumorMarginMasked } from "@/domain/RouteRumor";
import { t } from "@/i18n/i18n";
import { isSystemKnown } from "@/systems/galaxy/systemKnown";

export const RUMOR_PANEL_MAX = 4;
export function rumorPanelHeader(): string {
  return t("rumor.panelHeader");
}
export function rumorPanelEmpty(): string {
  return t("rumor.panelEmpty");
}
export function rumorPanelNoIntel(): string {
  return t("rumor.panelNoIntel");
}

export interface RumorPanelLine {
  id: string;
  text: string;
}

export interface RumorPanelData {
  lines: RumorPanelLine[];
  emptyText: string | null;
}

export function buildRumorPanel(
  galaxy: Galaxy | null,
  max = RUMOR_PANEL_MAX,
  player: Player | null = null,
  hideUnknown = false,
): RumorPanelData {
  if (!galaxy) return { lines: [], emptyText: rumorPanelEmpty() };
  let rumors = galaxy
    .getActiveRumors()
    .filter(
      (r) =>
        !galaxy.isHostileSystem(r.fromSystemId) &&
        !galaxy.isHostileSystem(r.toSystemId),
    );
  const filtering = hideUnknown && player != null;
  if (filtering) {
    rumors = rumors.filter(
      (r) =>
        isSystemKnown(player, galaxy, r.fromSystemId) &&
        isSystemKnown(player, galaxy, r.toSystemId),
    );
  }
  rumors = rumors.slice(0, max);
  if (rumors.length === 0) {
    return {
      lines: [],
      emptyText: filtering ? rumorPanelNoIntel() : rumorPanelEmpty(),
    };
  }
  return {
    lines: rumors.map((r) => {
      const knownRoute =
        player == null ||
        (isSystemKnown(player, galaxy, r.fromSystemId) &&
          isSystemKnown(player, galaxy, r.toSystemId));
      return { id: r.id, text: describeRumor(r, galaxy, !knownRoute) };
    }),
    emptyText: null,
  };
}

const NEWS_MARGIN_RE = /(?:маржа|margin) ~\d+%/;

export interface TradeNewsLike {
  type: string;
  fromSystemId?: string;
  toSystemId?: string;
}

export interface NewsEventLike {
  type: string;
  systemId: string;
  fromSystemId?: string;
  toSystemId?: string;
}

export function feedEventVisible(
  event: NewsEventLike,
  galaxy: Galaxy,
  player: Player | null,
): boolean {
  if (event.type === "TRADE_OPPORTUNITY") {
    if (!event.fromSystemId || !event.toSystemId) return true;
    if (
      galaxy.isHostileSystem(event.fromSystemId) ||
      galaxy.isHostileSystem(event.toSystemId)
    ) {
      return false;
    }
    if (player == null) return true;
    return (
      isSystemKnown(player, galaxy, event.fromSystemId) &&
      isSystemKnown(player, galaxy, event.toSystemId)
    );
  }
  if (player == null) return true;
  return isSystemKnown(player, galaxy, event.systemId);
}

export function maskTradeNewsMargin(
  desc: string,
  event: TradeNewsLike,
  galaxy: Galaxy,
  player: Player | null,
): string {
  if (
    player == null ||
    event.type !== "TRADE_OPPORTUNITY" ||
    !event.fromSystemId ||
    !event.toSystemId
  ) {
    return desc;
  }
  const known =
    isSystemKnown(player, galaxy, event.fromSystemId) &&
    isSystemKnown(player, galaxy, event.toSystemId);
  return known ? desc : desc.replace(NEWS_MARGIN_RE, rumorMarginMasked());
}
