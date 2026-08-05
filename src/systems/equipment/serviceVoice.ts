const SERVICE_BOT = "⚙ Сервис-бот";

export function repairVoiceLine(cost: number): string {
  return `${SERVICE_BOT}: корпус восстановлен за ${cost} ₡. Все системы в норме — к вылету готовы.`;
}

export function refuelVoiceLine(cost: number): string {
  return `${SERVICE_BOT}: баки заправлены за ${cost} ₡. Топливная система в норме — курс свободен.`;
}

export function diagnosticVoiceLine(cost: number): string {
  return `${SERVICE_BOT}: диагностика завершена, корпус восстановлен за ${cost} ₡. Проверка пройдена — к вылету готовы.`;
}
