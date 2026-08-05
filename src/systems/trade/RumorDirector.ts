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

export type RouteScanFn = () => RouteCandidate[];

export interface RumorDirectorConfig {
  marginOpen: number;
  marginExpire: number;
  maxActive: number;
}

export interface RumorUpdateResult {
  opened: RouteRumor[];
  expired: RouteRumor[];
  active: RouteRumor[];
}

function systemName(galaxy: Galaxy, systemId: string): string {
  return galaxy.systems.find((s) => s.id === systemId)?.name ?? systemId;
}

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

  const survivors: RouteRumor[] = [];
  const expired: RouteRumor[] = [];
  for (const rumor of galaxy.activeRumors) {
    const cand = byId.get(rumor.id);
    if (cand) {
      rumor.lastMarginPct = cand.marginPct;
      rumor.fromPrice = cand.fromPrice;
      rumor.toPrice = cand.toPrice;
    } else {
      rumor.lastMarginPct = 0;
    }
    if (rumor.lastMarginPct <= cfg.marginExpire) {
      expired.push(rumor);
    } else {
      survivors.push(rumor);
    }
  }

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
