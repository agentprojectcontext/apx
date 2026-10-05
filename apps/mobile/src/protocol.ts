// The native adapter supplies secure randomness; the shared client still owns every protocol call.
import { randomUUID } from "expo-crypto";
import { type ClientOptions, ApxClient as ProtocolClient } from "../../../packages/protocol/src/client.ts";

export { ApxError, type ApxSocket } from "../../../packages/protocol/src/client.ts";
export type { CoreEvent, Message, Surface, Thread } from "../../../packages/protocol/src/index.ts";

export class ApxClient extends ProtocolClient {
  constructor(options: ClientOptions) {
    super({ ...options, requestKey: randomUUID });
  }
}
