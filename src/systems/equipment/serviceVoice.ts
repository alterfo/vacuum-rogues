/**
 * Robot-assistant service voice lines (canon §11.4).
 *
 * Repair / refuel / hull-diagnostic actions at a station or in the hangar used to
 * confirm with a bare mechanical toast («Корпус восстановлен за N ₡»). Canon asks
 * for a short robot-assistant voice — a «System check: … Ship ready for launch»
 * flavour — on those interactions. These pure builders return the full toast text
 * so both hub surfaces (`StationScene` service buttons and the shared
 * `HangarPanel` СЕРВИСНЫЙ ЦЕНТР) speak with one voice and stay unit-testable
 * without any PixiJS wiring.
 *
 * They keep the real cost figure the player needs while wrapping it in the
 * sluzhebnyy-bot framing, so the message stays informative and in-character.
 */

/** Speaker tag shared by every service line. */
const SERVICE_BOT = "⚙ Сервис-бот";

/** Hull repair at a station or hangar service point. */
export function repairVoiceLine(cost: number): string {
  return `${SERVICE_BOT}: корпус восстановлен за ${cost} ₡. Все системы в норме — к вылету готовы.`;
}

/** Fuel/energy top-up at a station. */
export function refuelVoiceLine(cost: number): string {
  return `${SERVICE_BOT}: баки заправлены за ${cost} ₡. Топливная система в норме — курс свободен.`;
}

/** Hull diagnostic + repair at the hangar СЕРВИСНЫЙ ЦЕНТР. */
export function diagnosticVoiceLine(cost: number): string {
  return `${SERVICE_BOT}: диагностика завершена, корпус восстановлен за ${cost} ₡. Проверка пройдена — к вылету готовы.`;
}
