import type { Agent } from "@apx/protocol";
import { Button, IconButton, Icons } from "@apx/ui";
import { useCanCall } from "../call/callStatus.ts";
import { openCall, useCalls } from "../data/calls.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "./nav.ts";

/** The call going on, from this panel or (calls.status) another one. */
const useLiveCall = (): string | undefined => useCalls((s) => s.live ?? s.status?.live);

/**
 * A call to an agent (the top bar's for the super-agent, an agent's chat and profile): opens the call card, or, during
 * a call (marked), goes back to it. Hidden where calls can never run (not a Mac with Apple silicon); otherwise the
 * card says what is missing. `labeled`: a button with its words, instead of an icon.
 */
export function CallButton({
  agent,
  className,
  labeled = false,
}: {
  agent: Agent;
  className?: string;
  labeled?: boolean;
}) {
  const t = useT();
  const canCall = useCanCall();
  const live = useLiveCall();
  if (!canCall) return null;
  const label = live ? t("call.back") : t("call.start", { name: agent.name });
  const onClick = () => (live ? go.inboxThread(live) : openCall({ agent: agent.id }));
  return labeled ? (
    <Button
      size="sm"
      variant="secondary"
      className={className}
      leadingIcon={<Icons.Phone size={14} />}
      onClick={onClick}
    >
      {label}
    </Button>
  ) : (
    <IconButton
      size="sm"
      className={className}
      {...(live ? { mark: "brand" as const } : {})}
      label={label}
      icon={<Icons.Phone size={14} />}
      onClick={onClick}
    />
  );
}

/** In a call's chat: call its agent again, in this same chat. Gone while a call goes on, or when the agent is gone. */
export function CallAgain({ thread, agent }: { thread: string; agent: string | undefined }) {
  const t = useT();
  const canCall = useCanCall();
  const live = useLiveCall();
  const open = useCalls((s) => s.card != null);
  const here = useData((s) => (agent ? Boolean(s.agents[agent]) : false));
  if (!canCall || live || open || !agent || !here) return null;
  return (
    <Button
      size="sm"
      variant="secondary"
      className="callagain"
      aria-label={t("call.again")}
      leadingIcon={<Icons.Phone size={14} />}
      onClick={() => openCall({ agent, thread })}
    >
      <span className="callagain__label">{t("call.again")}</span>
    </Button>
  );
}
