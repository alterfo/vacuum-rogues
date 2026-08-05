import type { ErrorResponse } from "@/types";

export interface IExceptionHandler {
  handle(error: Error): ErrorResponse;
  onCriticalError?: (response: ErrorResponse) => void;
}
