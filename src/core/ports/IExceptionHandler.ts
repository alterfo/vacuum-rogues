import type { ErrorResponse } from "@/types";

/**
 * Port for global exception handling.
 * Follows DIP and Indirection: GameEngine delegates error classification.
 */
export interface IExceptionHandler {
  handle(error: Error): ErrorResponse;
  onCriticalError?: (response: ErrorResponse) => void;
}
