import type { ApxErrorShape } from "@apx/protocol";

/** A failure that should reach the caller with its own code, not as `internal`. */
export class CallError extends Error {
  readonly shape: ApxErrorShape;
  constructor(shape: ApxErrorShape) {
    super(shape.message);
    this.name = "CallError";
    this.shape = shape;
  }
}
