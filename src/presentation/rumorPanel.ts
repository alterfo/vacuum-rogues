import type { Galaxy } from "@/domain/Galaxy";
import type { Player } from "@/domain/Player";
import { describeRumor } from "@/domain/RouteRumor";
import { isSystemKnown } from "@/systems/galaxy/systemKnown";

// ── Trade-route rumors panel (pure projection, no PixiJS) ─────────────────────

/** Most-profitable rumors shown in the news tab's "Торговые возможности" band. */
export const RUMOR_PANEL_MAX = 4;
export const RUMOR_PANEL_HEADER = "ТОРГОВЫЕ ВОЗМОЖНОСТИ";
export const RUMOR_PANEL_EMPTY = "Активных торговых маршрутов нет";

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
 */
export function buildRumorPanel(
  galaxy: Galaxy | null,
  max = RUMOR_PANEL_MAX,
  player: Player | null = null,
): RumorPanelData {
  if (!galaxy) return { lines: [], emptyText: RUMOR_PANEL_EMPTY };
  const rumors = galaxy.getActiveRumors().slice(0, max);
  if (rumors.length === 0) return { lines: [], emptyText: RUMOR_PANEL_EMPTY };
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
