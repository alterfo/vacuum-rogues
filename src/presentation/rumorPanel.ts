import type { Galaxy } from "@/domain/Galaxy";
import type { Player } from "@/domain/Player";
import { describeRumor, rumorMarginMasked } from "@/domain/RouteRumor";
import { t } from "@/i18n/i18n";
import { isSystemKnown } from "@/systems/galaxy/systemKnown";

// ── Trade-route rumors panel (pure projection, no PixiJS) ─────────────────────

/** Most-profitable rumors shown in the news tab's "Торговые возможности" band. */
export const RUMOR_PANEL_MAX = 4;
/** Localized header for the rumor band ("ТОРГОВЫЕ ВОЗМОЖНОСТИ" by default). */
export function rumorPanelHeader(): string {
  return t("rumor.panelHeader");
}
/** Localized empty-state copy when there are no active rumors. */
export function rumorPanelEmpty(): string {
  return t("rumor.panelEmpty");
}
/**
 * Localized empty-state copy for the `hideUnknown` path: the panel is filtered to
 * scouted space and there is no trade intel for a known route yet ("scout new
 * systems"). Distinct from {@link rumorPanelEmpty} ("no active routes at all").
 */
export function rumorPanelNoIntel(): string {
  return t("rumor.panelNoIntel");
}

export interface RumorPanelLine {
  id: string;
  text: string;
}

export interface RumorPanelData {
  /** Rumor rows, already sorted most-profitable first. */
  lines: RumorPanelLine[];
  /** Empty-state copy when there are no active rumors (else null). */
  emptyText: string | null;
}

/**
 * Pure projection of the galaxy's active trade-route rumors into display rows.
 * Sorted most-profitable first (delegated to `Galaxy.getActiveRumors`), capped
 * to `max`, each row formatted via the domain `describeRumor` one-liner. Returns
 * the empty-state copy when there are no active rumors so the panel always has
 * something to render. Lives outside `InfoCenterScene` so it can be unit-tested
 * without pulling in PixiJS.
 *
 * Partial observability: when a `player` is supplied, a rumor's margin number is
 * shown **only if every system the route depends on is known** — both endpoints
 * explored on the star-map or visited (`isSystemKnown`). For a route touching an
 * undiscovered system the margin is masked («маржа ~?%») while the товар/route
 * text still renders, so the player can't read the profit of a route into a
 * system they've never seen. With no `player` (legacy callers/tests) nothing is
 * masked, preserving the prior behaviour.
 *
 * `hideUnknown` (the playtest "hide unexplored systems entirely" follow-up):
 * when true (and a `player` is supplied) a route touching an undiscovered system
 * is **dropped from the list** rather than margin-masked — so the feed never
 * names a system the player has not scouted. When everything is filtered out the
 * empty-state becomes {@link rumorPanelNoIntel} ("scout new systems") instead of
 * the generic "no active routes". Default `false` preserves the legacy
 * margin-masking behaviour (and every existing caller/test).
 */
export function buildRumorPanel(
  galaxy: Galaxy | null,
  max = RUMOR_PANEL_MAX,
  player: Player | null = null,
  hideUnknown = false,
): RumorPanelData {
  if (!galaxy) return { lines: [], emptyText: rumorPanelEmpty() };
  let rumors = galaxy.getActiveRumors();
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

/**
 * A baked margin number in a news/rumor string, e.g. "маржа ~70%" / "margin
 * ~70%". Matches either language so a description baked under one language is
 * still re-maskable when rendered (the leading word is the localized prefix of
 * `rumor.margin`).
 */
const NEWS_MARGIN_RE = /(?:маржа|margin) ~\d+%/;

/** Structural shape of the `TRADE_OPPORTUNITY` news event fields masking consults. */
export interface TradeNewsLike {
  type: string;
  fromSystemId?: string;
  toSystemId?: string;
}

/** Structural shape of a news-feed event the visibility filter reads. */
export interface NewsEventLike {
  type: string;
  systemId: string;
  fromSystemId?: string;
  toSystemId?: string;
}

/**
 * Partial observability for the InfoCenter **news feed**: whether an event may be
 * shown given what the player has scouted (the playtest "hide unexplored systems
 * entirely" follow-up). A `TRADE_OPPORTUNITY` route requires **both** endpoints
 * known; every other event requires its single `systemId` known — so the feed
 * never names a system the player has never seen. With no `player`
 * (legacy/headless) everything is visible, and a malformed trade event missing an
 * endpoint id falls through to visible (don't hide on bad data). Pure — keyed off
 * the shared `isSystemKnown` predicate so the rule is never re-derived.
 */
export function feedEventVisible(
  event: NewsEventLike,
  galaxy: Galaxy,
  player: Player | null,
): boolean {
  if (player == null) return true;
  if (event.type === "TRADE_OPPORTUNITY") {
    if (!event.fromSystemId || !event.toSystemId) return true;
    return (
      isSystemKnown(player, galaxy, event.fromSystemId) &&
      isSystemKnown(player, galaxy, event.toSystemId)
    );
  }
  return isSystemKnown(player, galaxy, event.systemId);
}

/**
 * Partial observability for the InfoCenter **news feed** (the «[МАРШРУТ]» rows).
 * A `TRADE_OPPORTUNITY` event's `description` is baked unmasked at open time (and
 * persisted), so the same margin the rumor panel hides would otherwise leak one
 * band below. Re-mask it at render time against the player's *current* knowledge:
 * the number («маржа ~N%» → «маржа ~?%») is hidden unless **both** endpoints are
 * known (explored/visited). Non-trade events, events without both endpoints, and
 * the no-`player` legacy path pass through untouched (so a margin re-appears once
 * the player explores the system).
 */
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
