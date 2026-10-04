// The one contract, straight from the monorepo: the client has no zod (the core validates), types are erased.
export { ApxClient, ApxError, type ApxSocket } from "../../../packages/protocol/src/client.ts";
export type { CoreEvent, Message, Surface, Thread } from "../../../packages/protocol/src/index.ts";
