import { HttpsError, type FunctionsErrorCode } from "firebase-functions/v2/https";
import type { ZodError, ZodType } from "zod";

export class CommandError extends Error {
  constructor(
    readonly code: FunctionsErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

export function parseInput<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new CommandError("invalid-argument", "The command payload is invalid.", {
    issues: formatIssues(result.error),
  });
}

function formatIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.slice(0, 12).map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function asHttpsError(cause: unknown): HttpsError {
  if (cause instanceof HttpsError) return cause;
  if (cause instanceof CommandError) {
    return new HttpsError(cause.code, cause.message, cause.details);
  }
  console.error("Unhandled callable failure", cause);
  return new HttpsError("internal", "The authoritative command could not be completed.");
}
