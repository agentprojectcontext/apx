import { type ApxErrorShape, ErrorCode } from "@apx/protocol";

/** A failure that should reach the caller with its own code, not as `internal`. */
export class CallError extends Error {
  readonly shape: ApxErrorShape;
  constructor(shape: ApxErrorShape) {
    super(shape.message);
    this.name = "CallError";
    this.shape = shape;
  }
}

export const badRequest = (message: string) => new CallError({ code: ErrorCode.BadRequest, message });
export const notFound = (what: string) => new CallError({ code: ErrorCode.NotFound, message: `${what} not found` });
export const unauthorized = (message: string) => new CallError({ code: ErrorCode.Unauthorized, message });
export const conflict = (message: string) => new CallError({ code: ErrorCode.Conflict, message });
export const unavailable = (message: string) => new CallError({ code: ErrorCode.Unavailable, message, retryable: true });

/** An error's message for logs and notices, cut to `max` characters. */
export function errorMessage(err: unknown, max = 500): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, max);
}
