import type { IExceptionHandler } from "@/core/ports/IExceptionHandler";
import type { ErrorResponse, ErrorSeverity } from "@/types";

export class MockExceptionHandler implements IExceptionHandler {
  public handledErrors: Array<{ error: Error; response: ErrorResponse }> = [];
  public onCriticalError?: (response: ErrorResponse) => void;

  handle(error: Error): ErrorResponse {
    const response: ErrorResponse = {
      code: "MOCK_ERROR",
      message: error.message,
      severity: "WARNING" as ErrorSeverity,
      recoverable: true,
    };
    this.handledErrors.push({ error, response });
    return response;
  }
}
