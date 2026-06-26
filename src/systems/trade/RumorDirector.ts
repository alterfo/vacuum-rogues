import type { Galaxy } from "@/domain/Galaxy";
import {
  createRumor,
  describeRumor,
  resourceLabelRu,
  rumorId,
  type RouteRumor,
} from "@/domain/RouteRumor";
import { t } from "@/i18n/i18n";
import type { RouteCandidate } from "@/systems/trade/RouteScanner";

/**
 * A fresh scan of the galaxy's best cross-system trade routes, ranked by margin
 * descending (the contract of `RouteScanner.scanTradeRoutes`). The director is
 * decoupled from how the scan is produced so it stays unit-testable: callers
 * supply a closure (GameEngine wires the real scanner with a neutral price fn).
 *
 * The closure should be configured with a low/zero `minMarginPct` and a
 * `maxRoutes` ≥ the resource count, so an active rumor whose spread is closing
 * stays visible to the re-score step until it truly drops below the expire
 * threshold — a route that disappears from the scan is treated as expired.
 */
export type RouteScanFn = () => RouteCandidate[];

/** Lifecycle thresholds for the rumor director (sourced from GAME_BALANCE). */
export interface RumorDirectorConfig {
  /** A route's margin (%) must EXCEED this to be published as a new rumor. */
  marginOpen: number;
  /** An active rumor closes once its re-scored margin (%) falls to/below this. */
  marginExpire: number;
  /** Maximum number of rumors active at once. */
  maxActive: number;
}

/** What `updateRumors` changed this tick (handy for tests and callers). */
export interface RumorUpdateResult {
  /** Rumors newly opened this tick. */
  opened: RouteRumor[];
  /** Rumors that expired this tick (spread closed). */
  expired: RouteRumor[];
  /** The full active set after the update (also stored on the galaxy). */
  active: RouteRumor[];
}

/** System display name, falling back to the raw id. */
function systemName(galaxy: Galaxy, systemId: string): string {
  return galaxy.systems.find((s) => s.id === systemId)?.name ?? systemId;
}

/**
 * Advance the trade-route rumor lifecycle for one galaxy day. Pure with respect
 * to inputs other than the galaxy it mutates:
 *
 * 1. **Re-score** every active rumor from the fresh scan (updating its live
 *    `lastMarginPct` + reference prices). A rumor whose route no longer ranks in
 *    the scan has had its spread closed, so it is scored at 0.
 * 2. **Expire** rumors at/below `marginExpire`, emitting an "акция закончилась"
 *    news line for each.
 * 3. **Open** the most profitable scanned routes above `marginOpen` that are not
 *    already active, up to `maxActive` total, emitting a TRADE_OPPORTUNITY news
 *    line for each.
 *
 * The open/expire thresholds form a hysteresis band: a route opens at a wide
 * spread and only closes once trade has narrowed it well below the open level,
 * so a rumor cannot flap open/closed on day-to-day price drift.
 */
export function updateRumors(
  galaxy: Galaxy,
  scanFn: RouteScanFn,
  day: number,
  cfg: RumorDirectorConfig,
): RumorUpdateResult {
  const candidates = scanFn();
  const byId = new Map<string, RouteCandidate>();
  for (const cand of candidates) {
    const id = rumorId(cand);
    if (!byId.has(id)) byId.set(id, cand);
  }

  // 1 + 2: re-score existing rumors, partition into survivors vs expired.
  const survivors: RouteRumor[] = [];
  const expired: RouteRumor[] = [];
  for (const rumor of galaxy.activeRumors) {
    const cand = byId.get(rumor.id);
    if (cand) {
      rumor.lastMarginPct = cand.marginPct;
      rumor.fromPrice = cand.fromPrice;
      rumor.toPrice = cand.toPrice;
    } else {
      // Route fell out of the ranked scan → its spread has closed.
      rumor.lastMarginPct = 0;
    }
    if (rumor.lastMarginPct <= cfg.marginExpire) {
      expired.push(rumor);
    } else {
      survivors.push(rumor);
    }
  }

  // 3: open new rumors from the most profitable un-active routes.
  const activeIds = new Set(survivors.map((r) => r.id));
  const opened: RouteRumor[] = [];
  let slots = Math.max(0, cfg.maxActive - survivors.length);
  for (const cand of candidates) {
    if (slots <= 0) break;
    if (!(cand.marginPct > cfg.marginOpen)) continue;
    const id = rumorId(cand);
    if (activeIds.has(id)) continue;
    opened.push(createRumor(cand, day));
    activeIds.add(id);
    slots--;
  }

  galaxy.activeRumors = [...survivors, ...opened];

  // Emit news after the store is settled so the feed mirrors final state.
  for (const rumor of expired) {
    const from = systemName(galaxy, rumor.fromSystemId);
    const to = systemName(galaxy, rumor.toSystemId);
    galaxy.addNewsEvent({
      type: "MARKET_SHIFT",
      systemId: rumor.toSystemId,
      day,
      description: t("rumor.expired", {
        resource: resourceLabelRu(rumor.resource),
        from,
        to,
      }),
    });
  }
  for (const rumor of opened) {
    galaxy.addNewsEvent({
      type: "TRADE_OPPORTUNITY",
      systemId: rumor.fromSystemId,
      day,
      description: describeRumor(rumor, galaxy),
      resource: rumor.resource,
      fromSystemId: rumor.fromSystemId,
      toSystemId: rumor.toSystemId,
      marginPct: rumor.marginPct,
    });
  }

  return { opened, expired, active: galaxy.activeRumors };
}
