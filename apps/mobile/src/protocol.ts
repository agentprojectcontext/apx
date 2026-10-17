// The native adapter supplies secure randomness; the shared client still owns every protocol call.
import { randomUUID } from "expo-crypto";
import { type ClientOptions, ApxClient as ProtocolClient } from "../../../packages/protocol/src/client.ts";
import type { Params } from "../../../packages/protocol/src/index.ts";

export { ApxError, type ApxSocket } from "../../../packages/protocol/src/client.ts";
export type {
  CoreEvent,
  Message,
  NoticePrefs,
  RoutineRun,
  Schedule,
  Surface,
  TaskEvent,
  Thread,
} from "../../../packages/protocol/src/index.ts";
export { noticeText } from "../../../packages/protocol/src/notices.ts";

/** The owner's answer to a pending input: a decision (with how long it lasts) or a text. */
export type Answer = Omit<Params<"runs.respond">, "input">;

export class ApxClient extends ProtocolClient {
  constructor(options: ClientOptions) {
    super({ ...options, requestKey: randomUUID });
  }
}
