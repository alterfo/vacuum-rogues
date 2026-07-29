import { describe, it, expect, afterEach } from "vitest";
import { NpcRole } from "@/types";
import { roleLabel, npcNameplateTooltip } from "@/presentation/npcLabels";
import { setLanguage } from "@/i18n/i18n";

/**
 * Task 5 (fullscene UX sweep): the in-flight NPC nameplate tooltip once read
 * `${name} [${role}]`, leaking the raw enum (e.g. `[TRADER]`). It now renders
 * the localized role label via the shared `npcNameplateTooltip` helper.
 */
describe("NPC nameplate tooltip localization", () => {
  afterEach(() => setLanguage("ru"));

  it("renders a localized role label, never the raw enum, for every NpcRole (RU)", () => {
    setLanguage("ru");
    for (const role of Object.values(NpcRole)) {
      const label = roleLabel(role);
      // The label must be a real translation, not the enum value or the key.
      expect(label).not.toBe(role);
      expect(label).not.toBe(`role.${role}`);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("renders a localized role label for every NpcRole (EN)", () => {
    setLanguage("en");
    for (const role of Object.values(NpcRole)) {
      const label = roleLabel(role);
      expect(label).not.toBe(role);
      expect(label).not.toBe(`role.${role}`);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("wraps the name + localized role, not the raw enum, in the tooltip text", () => {
    setLanguage("ru");
    const tooltip = npcNameplateTooltip("Кара", NpcRole.TRADER);
    expect(tooltip).toBe("Кара [Торговец]");
    // The raw enum value must not leak into the player-facing string.
    expect(tooltip).not.toContain("TRADER");
  });

  it("uses the same label the contact panel shows for the same role", () => {
    setLanguage("ru");
    // roleLabel is the single source both surfaces read.
    expect(npcNameplateTooltip("X", NpcRole.PIRATE)).toBe(
      `X [${roleLabel(NpcRole.PIRATE)}]`,
    );
  });
});
