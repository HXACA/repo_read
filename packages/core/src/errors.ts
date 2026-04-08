export type ErrorCode =
  | "CONFIG_INVALID"
  | "CONFIG_NOT_FOUND"
  | "SECRET_NOT_FOUND"
  | "SECRET_STORE_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_AUTH_FAILED"
  | "MODEL_NOT_FOUND"
  | "MODEL_CAPABILITY_INSUFFICIENT"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_ALREADY_EXISTS"
  | "STORAGE_READ_ERROR"
  | "STORAGE_WRITE_ERROR"
  | "JOB_NOT_FOUND"
  | "JOB_ALREADY_RUNNING"
  | "JOB_INVALID_STATE"
  | "EVENT_WRITE_ERROR"
  | "UNKNOWN";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly context?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.context = context;
  }
}
