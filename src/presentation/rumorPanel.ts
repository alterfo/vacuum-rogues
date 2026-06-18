import type { Galaxy } from "@/domain/Galaxy";
import { describeRumor } from "@/domain/RouteRumor";

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
 */
export function buildRumorPanel(
  galaxy: Galaxy | null,
  max = RUMOR_PANEL_MAX,
): RumorPanelData {
  if (!galaxy) return { lines: [], emptyText: RUMOR_PANEL_EMPTY };
  const rumors = galaxy.getActiveRumors().slice(0, max);
  if (rumors.length === 0) return { lines: [], emptyText: RUMOR_PANEL_EMPTY };
  return {
    lines: rumors.map((r) => ({ id: r.id, text: describeRumor(r, galaxy) })),
    emptyText: null,
  };
}
