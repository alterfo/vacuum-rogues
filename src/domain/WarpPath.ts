export class WarpPath {
  constructor(
    public readonly fromSystemId: string,
    public readonly toSystemId: string,
    public readonly fuelCost: number,
  ) {}
}
