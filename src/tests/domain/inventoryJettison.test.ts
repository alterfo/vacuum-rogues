import { describe, it, expect } from "vitest";
import { Inventory } from "@/domain/Inventory";
import { ResourceType } from "@/types";
import { GameBusinessException } from "@/exceptions/GameBusinessException";

/**
 * Bug 2: jettison-to-space for cargo. `removeResource` is the domain mutation
 * the InventoryScene jettison action routes through — no credit refund
 * (selling is the separate paid path in the equipment shop/hangar).
 */
describe("Inventory.removeResource", () => {
  it("partially removes a stack, leaving the remainder", () => {
    const inv = new Inventory();
    inv.addResource(ResourceType.FUEL, 10);
    inv.removeResource(ResourceType.FUEL, 4);
    expect(
      inv.resources.find((r) => r.type === ResourceType.FUEL)?.amount,
    ).toBe(6);
  });

  it("removes the full stack down to zero", () => {
    const inv = new Inventory();
    inv.addResource(ResourceType.METALS, 5);
    inv.removeResource(ResourceType.METALS, 5);
    expect(
      inv.resources.find((r) => r.type === ResourceType.METALS)?.amount,
    ).toBe(0);
  });

  it("throws for a resource type not held at all", () => {
    const inv = new Inventory();
    expect(() => inv.removeResource(ResourceType.CRYSTALS, 1)).toThrow(
      GameBusinessException,
    );
    expect(inv.resources).toEqual([]);
  });

  it("throws when the requested amount exceeds the held stack (no partial mutation)", () => {
    const inv = new Inventory();
    inv.addResource(ResourceType.ORGANICS, 3);
    expect(() => inv.removeResource(ResourceType.ORGANICS, 4)).toThrow(
      GameBusinessException,
    );
    expect(
      inv.resources.find((r) => r.type === ResourceType.ORGANICS)?.amount,
    ).toBe(3);
  });
});
