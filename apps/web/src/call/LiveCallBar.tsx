import "../styles/call.css";
import { IconButton, Icons, Tooltip } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { AgentFace } from "../common/AgentFace.tsx";
import { callScene, useCalls } from "../data/calls.ts";
import { client } from "../data/client.ts";
import { secretary } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { loadCallStatus } from "./callStatus.ts";
import { useCardPlace } from "./cardPlace.ts";

/** How often it asks whether the call still goes on, while the panel is in view. */
const CHECK_MS = 5000;

/**
 * A call going on somewhere else (on the phone, or in another window), folded like the call card's head: who, where,
 * and hang up. A press on it opens the call's chat.
 */
export function LiveCallBar() {
  const t = useT();
  const thread = useCalls((s) => (callScene(s) === "elsewhere" ? s.status?.live : undefined));
  const device = useCalls((s) => s.status?.live_device);
  const agent = useData((s) => {
    const id = thread ? s.threads[thread]?.agent_ids[0] : undefined;
    return (id ? s.agents[id] : undefined) ?? secretary(s.agents);
  });
  const name = agent?.name ?? "";
  const [ending, setEnding] = useState(false);
  const card = useRef<HTMLElement>(null);
  const placed = useCardPlace(card, thread ? () => go.inboxThread(thread) : undefined);

  // Whether it still goes on: its chat's changes say so too, but an end on the phone may say nothing here.
  useEffect(() => {
    const check = () => {
      if (!document.hidden) void loadCallStatus();
    };
    const tick = setInterval(check, CHECK_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(tick);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  if (!thread) return null;
  const hangUp = async () => {
    setEnding(true);
    try {
      await client.call("calls.end", { thread_id: thread });
    } catch {
      notify(t("callBar.failed"));
    }
    await loadCallStatus();
    setEnding(false);
  };

  return (
    <section
      ref={card}
      className="callcard"
      style={placed.style}
      data-small=""
      data-stage="live"
      aria-label={t("callCard.label", { name })}
    >
      <Tooltip content={t("callCard.openChat")}>
        <div className="callcard__head" onPointerDown={placed.onPointerDown}>
          <span className="callcard__face">
            {agent ? <AgentFace agent={agent} size={36} /> : <Icons.Phone size={16} aria-hidden="true" />}
          </span>
          <div className="callcard__who">
            <div className="callcard__name">{name}</div>
            <div className="callcard__state">{device ? t("callBar.onDevice", { device }) : t("callBar.elsewhere")}</div>
          </div>
          <IconButton
            size="sm"
            label={t("callCard.openChat")}
            icon={<Icons.MessageSquare size={14} />}
            onClick={() => go.inboxThread(thread)}
          />
          <IconButton
            size="sm"
            className="callcard__hangup"
            label={t("callCard.hangUp")}
            disabled={ending}
            icon={<Icons.PhoneOff size={14} />}
            onClick={() => void hangUp()}
          />
        </div>
      </Tooltip>
    </section>
  );
}
