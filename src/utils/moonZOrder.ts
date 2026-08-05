const TWO_PI = Math.PI * 2;

export function getMoonLayer(angle: number): "back" | "front" {
  const norm = ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  return norm < Math.PI ? "back" : "front";
}
