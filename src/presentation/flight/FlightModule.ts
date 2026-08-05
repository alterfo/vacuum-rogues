export interface FlightModule {
  initialize(): void;
  update(dt: number, bgElapsed: number): void;
  destroy(): void;
}
