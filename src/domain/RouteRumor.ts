import type { Galaxy } from "@/domain/Galaxy";
import { t } from "@/i18n/i18n";
import { ResourceType } from "@/types";

export interface RouteRumor {
  id: string;
  resource: ResourceType;
  fromSystemId: string;
  fromPlanetId: string;
  toSystemId: string;
  toPlanetId: string;
  fromPrice: number;
  toPrice: number;
  marginPct: number;
  createdDay: number;
  lastMarginPct: number;
}

export type RouteLike = Omit<RouteRumor, "id" | "createdDay" | "lastMarginPct">;

export function rumorId(route: RouteLike): string {
  return `${route.resource}:${route.fromSystemId}->${route.toSystemId}`;
}

export function createRumor(route: RouteLike, day: number): RouteRumor {
  return {
    id: rumorId(route),
    resource: route.resource,
    fromSystemId: route.fromSystemId,
    fromPlanetId: route.fromPlanetId,
    toSystemId: route.toSystemId,
    toPlanetId: route.toPlanetId,
    fromPrice: route.fromPrice,
    toPrice: route.toPrice,
    marginPct: route.marginPct,
    createdDay: day,
    lastMarginPct: route.marginPct,
  };
}

export function resourceLabelRu(resource: ResourceType): string {
  return t(`resource.${resource}`);
}

export function rumorMarginMasked(): string {
  return t("rumor.marginMasked");
}

export function describeRumor(
  rumor: RouteRumor,
  galaxy: Galaxy,
  maskMargin = false,
): string {
  const fromName =
    galaxy.systems.find((s) => s.id === rumor.fromSystemId)?.name ??
    rumor.fromSystemId;
  const toName =
    galaxy.systems.find((s) => s.id === rumor.toSystemId)?.name ??
    rumor.toSystemId;
  const margin = maskMargin
    ? rumorMarginMasked()
    : t("rumor.margin", { pct: Math.round(rumor.lastMarginPct) });
  return t("rumor.line", {
    resource: resourceLabelRu(rumor.resource),
    from: fromName,
    to: toName,
    margin,
  });
}
