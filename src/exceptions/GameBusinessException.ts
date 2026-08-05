export class GameBusinessException extends Error {
  public readonly errorCode: string;
  public readonly errorMessage: string;
  public readonly context: object;

  constructor(code: string, message: string, context?: object) {
    super(message);
    this.name = "GameBusinessException";
    this.errorCode = code;
    this.errorMessage = message;
    this.context = context ?? {};

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GameBusinessException);
    }
  }
}
