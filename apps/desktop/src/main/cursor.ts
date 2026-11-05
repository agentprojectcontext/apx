import type { CursorAgent, NativePointer } from "./computer-native-pointer.ts";
import { createCursor as createElectronCursor } from "./cursor-electron.ts";

export type AgentCursor = {
  moveTo(x: number, y: number, label: string): Promise<void>;
  say(label: string): void;
  pulse(): void;
  hide(): void;
  close(): void;
  selectAgent?(agent: CursorAgent): void;
};

/** macOS receives its bundled native helper; other platforms retain the existing cursor. */
export function createCursor(native?: NativePointer): AgentCursor {
  return native ?? createElectronCursor();
}
