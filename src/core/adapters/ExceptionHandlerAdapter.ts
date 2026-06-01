import type { IExceptionHandler } from "@/core/ports/IExceptionHandler";
import type { ErrorResponse } from "@/types";
import { GlobalExceptionHandler } from "@/exceptions/GlobalExceptionHandler";

/**
 * Adapter: makes GlobalExceptionHandler compatible with IExceptionHandler port.
 */
export class ExceptionHandlerAdapter implements IExceptionHandler {
  private readonly delegate = GlobalExceptionHandler.getInstance();

  handle(error: Error): ErrorResponse {
    return this.delegate.handle(error);
  }

  set onCriticalError(
    callback: ((response: ErrorResponse) => void) | undefined,
  ) {
    this.delegate.onCriticalError = callback;
  }

  get onCriticalError(): ((response: ErrorResponse) => void) | undefined {
    return this.delegate.onCriticalError;
  }
}
