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
