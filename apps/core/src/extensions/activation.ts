import { randomUUID } from "node:crypto";
import { conflict } from "../errors.ts";

type Activation = { id: string; enabled: boolean; only_if_disabled?: boolean; rollback_token?: string };

/** A rollback may undo only its own off-to-on transition, not a later owner's change. */
export function activationGuard() {
  // A restart expires receipts: an old client must read the persisted state instead of undoing it.
  const tokens = new Map<string, string>();
  return {
    invalidate(id: string) {
      tokens.delete(id);
    },
    async change<E extends { enabled: boolean }>(
      params: Activation,
      current: () => E,
      change: () => E | Promise<E>,
    ): Promise<E & { activation_token?: string }> {
      if (params.rollback_token && tokens.get(params.id) !== params.rollback_token) return current();
      if (params.only_if_disabled && current().enabled)
        throw conflict("The extension is already on; refresh its connection state");
      tokens.delete(params.id);
      const updated = await change();
      if (!params.only_if_disabled) return updated;
      const token = randomUUID();
      tokens.set(params.id, token);
      return { ...updated, activation_token: token };
    },
  };
}
