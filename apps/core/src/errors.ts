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
export const unavailable = (message: string) =>
  new CallError({ code: ErrorCode.Unavailable, message, retryable: true });

/** An error's message, cut to `max` characters when given. */
export function errorMessage(err: unknown, max?: number): string {
  const m = err instanceof Error ? err.message : String(err);
  return max === undefined ? m : m.slice(0, max);
}

/** Why a turn's signal was aborted: the owner canceled it, its time ran out, or APX is shutting down. */
export class Canceled extends Error {
  constructor(message = "canceled by the owner") {
    super(message);
    this.name = "Canceled";
  }
}

export class DeadlineExceeded extends Error {
  constructor(message = "the turn ran out of time") {
    super(message);
    this.name = "DeadlineExceeded";
  }
}

export class Shutdown extends Error {
  constructor() {
    super("APX is shutting down");
    this.name = "Shutdown";
  }
}
