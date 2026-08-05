import { logger } from "@/utils/logger";
import type { ShipLoadout } from "./equipment/ShipLoadout";
import { gearById, GearKind } from "./equipment/GearCatalog";

export class EquipmentSystem {
  installGear(loadout: ShipLoadout, gearId: string): boolean {
    const gear = gearById(gearId);
    if (!gear || gear.kind === GearKind.HULL) return false;
    const installed = loadout.install(gearId);
    if (installed) {
      logger.info(`${gear.name} installed into loadout`);
    }
    return installed;
  }

  installLoot(loadout: ShipLoadout, gearId: string): boolean {
    return this.installGear(loadout, gearId);
  }
}
