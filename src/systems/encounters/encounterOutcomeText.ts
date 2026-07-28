import type { EncounterOutcome } from "./encounterOutcome";

/**
 * Russian, player-facing text for a resolved exploration-encounter outcome.
 *
 * Single source of the per-kind copy shared by the in-flight toast
 * (`EncounterController.encounterOutcomeMessage`) **and** the bank-ledger
 * reason builder (`applyEncounterOutcome`), so neither leaks the raw English
 * `outcome.kind` enum token into player-visible text. Pure — no PixiJS/DOM.
 */
export function encounterOutcomeMessageRu(outcome: EncounterOutcome): string {
  const credits = outcome.credits ?? 0;
  switch (outcome.kind) {
    case "salvage":
      return `Обломок обчищен: +${credits} кр.`;
    case "trap":
      return "Это была ловушка — враги открывают огонь!";
    case "bonus":
      return `Аномалия просканирована: +${credits} кр.`;
    case "hazard":
      return `Аномалия повредила системы: ${credits} кр.`;
    case "rescue":
      return `Экипаж спасён: +${credits} кр. и доброе имя.`;
    case "ambush":
      return "Сигнал SOS оказался засадой!";
    case "ignored":
    default:
      return "Вы уходите, не вмешиваясь.";
  }
}
