// The panel's mode, read and set from any client or by the super-agent (apx_settings), told live to every panel.
import type { Bus } from "../bus.ts";
import { panelMode, setPanelMode } from "../domain/panel-mode.ts";
import type { Store } from "../domain/store.ts";
import type { Handlers } from "./router.ts";

export function panelModeHandlers(store: Store, bus: Bus) {
  return {
    "panel.mode": () => ({ mode: panelMode(store) }),
    "panel.set_mode": ({ mode }) => {
      if (panelMode(store) !== mode) {
        setPanelMode(store, mode);
        bus.emit({ type: "panel.mode", mode });
      }
      return { mode };
    },
  } satisfies Partial<Handlers>;
}
