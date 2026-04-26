export class BrowserSessionError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = "BrowserSessionError";
  }
}

export const ErrorCodes = {
  CHROME_NOT_FOUND: "CHROME_NOT_FOUND",
  CHROME_LAUNCH_FAILED: "CHROME_LAUNCH_FAILED",
  CDP_CONNECT_FAILED: "CDP_CONNECT_FAILED",
  LOGIN_REQUIRED: "LOGIN_REQUIRED",
  LOGIN_TIMEOUT: "LOGIN_TIMEOUT",
  HUMAN_VERIFICATION_REQUIRED: "HUMAN_VERIFICATION_REQUIRED",
  UPSTREAM_FORBIDDEN: "UPSTREAM_FORBIDDEN",
  UPSTREAM_SCHEMA_CHANGED: "UPSTREAM_SCHEMA_CHANGED",
} as const;
