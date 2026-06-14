export function getRepLabel(rep: number): string {
  if (rep >= 50) return "Союзник";
  if (rep >= 10) return "Дружелюбный";
  if (rep >= -20) return "Нейтральный";
  if (rep >= -50) return "Недовольный";
  return "Враждебный";
}

export function getRepColor(rep: number): number {
  if (rep >= 50) return 0x00ff88;
  if (rep >= 10) return 0x88ff88;
  if (rep >= -20) return 0xaaaaaa;
  if (rep >= -50) return 0xff8888;
  return 0xff2222;
}
