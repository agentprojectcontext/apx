import type { Agent } from "@apx/protocol";
import { Button, IconButton, Icons } from "@apx/ui";
import { useEffect } from "react";
import { loadCallStatus } from "../call/callStatus.ts";
import { calls, openCall, useCalls } from "../data/calls.ts";
import { useT } from "../i18n/index.ts";
import { go } from "./nav.ts";

/** The call going on, from this panel or (calls.status) another one. */
const useLiveCall = (): string | undefined => useCalls((s) => s.live ?? s.status?.live);

/**
 * A call to the super-agent (the top bar, its chat's header): opens the call card, or, during a call (marked), goes
 * back to it. Hidden where calls can never run (not a Mac with Apple silicon); otherwise the card says what is missing.
 */
export function CallButton({ agent, className }: { agent: Agent; className?: string }) {
  const t = useT();
  const status = useCalls((s) => s.status);
  const live = useLiveCall();
  useKnownStatus();
  if (!status || status.missing === "platform") return null;
  return live ? (
    <IconButton
      size="sm"
      className={className}
      mark="brand"
      label={t("call.back")}
      icon={<Icons.Phone size={14} />}
      onClick={() => go.inboxThread(live)}
    />
  ) : (
    <IconButton
      size="sm"
      className={className}
      label={t("call.start", { name: agent.name })}
      icon={<Icons.Phone size={14} />}
      onClick={() => openCall()}
    />
  );
}

/** In a call's chat: call again, in this same chat. Gone while a call goes on. */
export function CallAgain({ thread }: { thread: string }) {
  const t = useT();
  const status = useCalls((s) => s.status);
  const live = useLiveCall();
  const open = useCalls((s) => s.card != null);
  useKnownStatus();
  if (!status || status.missing === "platform" || live || open) return null;
  return (
    <Button size="sm" variant="secondary" leadingIcon={<Icons.Phone size={14} />} onClick={() => openCall(thread)}>
      {t("call.again")}
    </Button>
  );
}

/** Asks once whether calls can run here, when the first button that needs it shows. */
function useKnownStatus() {
  useEffect(() => {
    if (!calls.get().status) void loadCallStatus();
  }, []);
}
