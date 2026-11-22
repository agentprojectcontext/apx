import { extensionGeneration } from "../domain/extensions.ts";
import type { Store } from "../domain/store.ts";
import { conflict } from "../errors.ts";
import type { CallContext } from "./context.ts";

/** Called inside the transaction that creates the message and its run. */
export function checkExtensionReceipt(store: Store, claim: NonNullable<CallContext["extensionEvent"]>, thread: string) {
  const receipt = store.extensionEvents.get(claim.receipt);
  const config = store.extensionEvents.config(claim.extension);
  const ext = store.extensions.get(claim.extension);
  if (
    receipt?.state !== "pending" ||
    receipt.thread !== thread ||
    receipt.extension !== claim.extension ||
    receipt.generation !== claim.generation ||
    !config?.config.enabled ||
    config.revision !== receipt.revision ||
    config.generation !== receipt.generation ||
    !ext?.enabled ||
    extensionGeneration(ext) !== receipt.generation
  )
    throw conflict("Extension notice is no longer pending");
}
