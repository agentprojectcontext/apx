import { useEffect, useSyncExternalStore } from "react";
import type { ActiveTurn } from "../types/daemon";
import {
  readChatActivity,
  seedActiveTurn,
  setChatVisible,
  subscribeChatActivity,
} from "../lib/chat-activity";

export function useChatActivity(key: string | null, active?: ActiveTurn | null) {
  useEffect(() => { seedActiveTurn(key, active); }, [key, active]);
  return useSyncExternalStore(
    subscribeChatActivity,
    () => readChatActivity(key),
    () => readChatActivity(key),
  );
}

export function useChatVisibility(key: string | null) {
  useEffect(() => {
    setChatVisible(key, true);
    return () => setChatVisible(key, false);
  }, [key]);
}
