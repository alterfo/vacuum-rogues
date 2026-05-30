import type { EventType } from '@/types';
import type { StarSystem } from './StarSystem';

export interface Effect {
  readonly type: string;
  readonly value: number;
}

export class GalacticEvent {
  constructor(
    public readonly id: string,
    public readonly type: EventType,
    public readonly targetSystem: StarSystem,
    public durationDays: number,
    public readonly effects: Effect[],
  ) {}

  onTrigger(): void {
    // Override in subclasses
  }

  onExpire(): void {
    // Override in subclasses
  }
}

export class ChaosGateEvent extends GalacticEvent {
  constructor(
    id: string,
    targetSystem: StarSystem,
    durationDays: number,
    effects: Effect[],
  ) {
    super(id, 'CHAOS_GATE' as EventType, targetSystem, durationDays, effects);
  }
}

export class InvasionEvent extends GalacticEvent {
  constructor(
    id: string,
    targetSystem: StarSystem,
    durationDays: number,
    effects: Effect[],
  ) {
    super(id, 'INVASION' as EventType, targetSystem, durationDays, effects);
  }
}

export class TraderEvent extends GalacticEvent {
  constructor(
    id: string,
    targetSystem: StarSystem,
    durationDays: number,
    effects: Effect[],
  ) {
    super(id, 'TRADER' as EventType, targetSystem, durationDays, effects);
  }
}
