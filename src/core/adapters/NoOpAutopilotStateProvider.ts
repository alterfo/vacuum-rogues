import type { IAutopilotStateProvider } from "@/core/ports/IAutopilotStateProvider";

export class NoOpAutopilotStateProvider implements IAutopilotStateProvider {
  isEngaged(): boolean {
    return false;
  }
  resume(): void {}
}
