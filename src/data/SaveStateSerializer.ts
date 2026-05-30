import type { SaveState } from '@/domain/SaveState';

export class SaveStateSerializer {
  serialize(state: SaveState): string {
    return JSON.stringify(state, this.replacer);
  }

  deserialize(data: string): unknown {
    return JSON.parse(data, this.reviver);
  }

  private replacer(_key: string, value: unknown): unknown {
    if (value instanceof Map) {
      return {
        __type: 'Map',
        value: Array.from(value.entries()),
      };
    }
    if (value instanceof Set) {
      return {
        __type: 'Set',
        value: Array.from(value),
      };
    }
    return value;
  }

  private reviver(_key: string, value: unknown): unknown {
    if (value && typeof value === 'object' && '__type' in value) {
      const typed = value as { __type: string; value: unknown[] };
      if (typed.__type === 'Map') {
        return new Map(typed.value as [unknown, unknown][]);
      }
      if (typed.__type === 'Set') {
        return new Set(typed.value);
      }
    }
    return value;
  }
}
