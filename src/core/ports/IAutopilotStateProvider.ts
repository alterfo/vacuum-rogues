export interface IAutopilotStateProvider {
  isEngaged(): boolean;
  resume(engaged: boolean): void;
}
