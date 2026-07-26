export interface QuestParam {
  id: string;
  name: string;
  min: number;
  max: number;
  initial: number | "random";
  critMin?: number;
  critMax?: number;
  critTarget?: string;
  showInUI: boolean;
}

export interface QuestTransition {
  id: string;
  label: string;
  toLocation: string;
  condition?: string;
  effects: string[];
  autoExecute?: boolean;
}

export interface QuestLocation {
  id: string;
  /**
   * Narration prose for this location. A plain `string` renders verbatim; a
   * `string[]` is a variance *pool* — `QuestVM.currentLocationText()` picks one
   * variant deterministically from `(seed, locationId)` so a location reads
   * differently across playthroughs without desyncing numeric `random(...)`
   * rolls. See `src/systems/quests/scripts/README.md`.
   */
  text: string | string[];
  transitions: QuestTransition[];
  isSuccess?: boolean;
  isFailure?: boolean;
}

export interface QuestScript {
  id: string;
  title: string;
  params: QuestParam[];
  locations: QuestLocation[];
  startLocation: string;
}
