import { AsyncLocalStorage } from "node:async_hooks";
import { conflict } from "../errors.ts";

/**
 * One screen's lease between its agent and the owner. An epoch fences delayed tool continuations, including after
 * control is returned. It lives as long as the screen does: a screen that stops, a computer that stops or starts and a
 * core that restarts all give it back to the agent, so a lease nobody can see never blocks one.
 */
export function computerControl() {
  let mode: "agent" | "human" = "agent";
  let epoch = 0;
  let changing = false;
  let blocked = false;
  const lease = new AsyncLocalStorage<number>();
  const assert = (actor: "agent" | "human", version = epoch) => {
    if (changing || blocked || mode !== actor || version !== epoch)
      throw conflict(
        actor === "agent"
          ? "Computer is under manual control; return control before asking the agent"
          : "Take control of Computer first",
      );
  };
  return {
    status: () => ({ control: mode, changing: changing || blocked }),
    human: () => mode === "human" && !changing && !blocked,
    assert,
    version: () => epoch,
    async run<T>(actor: "agent" | "human", action: () => Promise<T>) {
      assert(actor);
      return lease.run(epoch, action);
    },
    checkCdp(method: string) {
      // Network interception must keep serving the owner's still-open browser.
      if (method === "Browser.getVersion" || /^Fetch\.(continueRequest|failRequest)$/.test(method)) return;
      assert("agent", lease.getStore() ?? -1);
    },
    async change(next: "agent" | "human", interrupt: () => Promise<void>) {
      if (changing) throw conflict("Computer control is changing");
      if (next === mode && !blocked) return;
      changing = true;
      epoch++;
      try {
        await interrupt();
        blocked = false;
        mode = next;
      } catch (error) {
        blocked = true;
        throw error;
      } finally {
        changing = false;
      }
    },
    /** The screen is gone: its agent has it again, and anything the owner's hands started is fenced off. */
    reset() {
      epoch++;
      mode = "agent";
      blocked = false;
    },
  };
}
export type ComputerControl = ReturnType<typeof computerControl>;
