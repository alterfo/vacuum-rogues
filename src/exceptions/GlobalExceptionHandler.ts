import type { ErrorResponse, ErrorSeverity } from '@/types';
import { GameBusinessException } from './GameBusinessException';
import { GameValidationException } from './GameValidationException';
import { GameSystemException } from './GameSystemException';
import { InferenceException } from './InferenceException';
import { logger } from '@/utils/logger';

export class GlobalExceptionHandler {
  private static instance: GlobalExceptionHandler;

  private constructor() {}

  static getInstance(): GlobalExceptionHandler {
    if (!GlobalExceptionHandler.instance) {
      GlobalExceptionHandler.instance = new GlobalExceptionHandler();
    }
    return GlobalExceptionHandler.instance;
  }

  handle(error: Error): ErrorResponse {
    const response = this.classify(error);

    if (response.severity === 'CRITICAL') {
      logger.error(`[CRITICAL] ${response.code}: ${response.message}`);
      // Trigger emergency auto-save via callback set by GameEngine
      this.onCriticalError?.(response);
    } else if (response.severity === 'WARNING') {
      logger.warn(`[WARNING] ${response.code}: ${response.message}`);
    } else {
      logger.info(`[INFO] ${response.code}: ${response.message}`);
    }

    return response;
  }

  private classify(error: Error): ErrorResponse {
    if (error instanceof GameBusinessException) {
      return {
        code: `BUSINESS_${error.errorCode}`,
        message: error.errorMessage,
        severity: 'WARNING' as ErrorSeverity,
        recoverable: true,
      };
    }

    if (error instanceof GameValidationException) {
      return {
        code: `VALIDATION_${error.errorCode}`,
        message: error.errorMessage,
        severity: 'WARNING' as ErrorSeverity,
        recoverable: true,
      };
    }

    if (error instanceof GameSystemException) {
      return {
        code: `SYSTEM_${error.errorCode}`,
        message: 'A system error occurred. Please try again or restart the game.',
        severity: 'CRITICAL' as ErrorSeverity,
        recoverable: false,
      };
    }

    if (error instanceof InferenceException) {
      return {
        code: `INFERENCE_${error.errorCode}`,
        message: 'AI inference failed. Falling back to heuristic mode.',
        severity: 'WARNING' as ErrorSeverity,
        recoverable: true,
      };
    }

    // Unknown error
    return {
      code: 'SYSTEM_UNKNOWN',
      message: 'An unexpected error occurred. Please try again.',
      severity: 'CRITICAL' as ErrorSeverity,
      recoverable: false,
    };
  }

  onCriticalError?: (response: ErrorResponse) => void;
}
