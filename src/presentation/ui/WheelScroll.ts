export function wheelDirection(deltaY: number): 1 | -1 | 0 {
  if (deltaY > 0) return 1;
  if (deltaY < 0) return -1;
  return 0;
}

export function attachWheelScroll(onScroll: (dir: 1 | -1) => void): () => void {
  const handler = (event: WheelEvent): void => {
    const dir = wheelDirection(event.deltaY);
    if (dir === 0) return;
    event.preventDefault();
    onScroll(dir);
  };
  window.addEventListener("wheel", handler, { passive: false });
  return () => window.removeEventListener("wheel", handler);
}
