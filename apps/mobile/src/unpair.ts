// Unpairing: the core revokes this phone's key first, so a copy of it stops working too; the phone forgets it anyway.
import { ApxError } from "../../../packages/protocol/src/client.ts";

/** `revoked`: the core no longer takes this phone's key. `local`: the core could not be reached; only the phone forgot. */
export type UnpairOutcome = "revoked" | "local";

export async function unpairDevice(
  revoke: () => Promise<unknown>,
  forget: () => Promise<void>,
): Promise<UnpairOutcome> {
  let outcome: UnpairOutcome = "local";
  try {
    await revoke();
    outcome = "revoked";
  } catch (error) {
    // A key the core already refuses is as good as revoked.
    if (error instanceof ApxError && error.code === "unauthorized") outcome = "revoked";
  }
  await forget();
  return outcome;
}
