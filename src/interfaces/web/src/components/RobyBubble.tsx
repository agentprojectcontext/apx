// "Chat con Roby" sheet — the super-agent reachable from anywhere. The
// launcher lives in the left rail; this component owns the Sheet + conversation.
//
// Same composer as Chats: files, images, interrupt, queue. The thread is the
// `web_sidebar` ledger (project 0), not a private copy — a photo pasted here
// has to render here, and a send while Roby is working has to queue or cut in
// the same way the big chat does.

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { Button } from "./ui/button";
import { Composer } from "./chat/Composer";
import { MessageList } from "./chat/MessageList";
import { ContextBar } from "./chat/ContextBar";
import { PendingTurns } from "./chat/PendingTurns";
import { InlineAskPanel, pendingAskQuestions } from "./chat/InlineAskPanel";
import { AgentAvatar, SUPER_AGENT_ICON } from "./agents/AgentAvatar";
import { Loading } from "./ui";
import { useChat } from "../hooks/useChat";
import { threadActivityKey } from "../lib/chat-activity";
import { useChatVisibility } from "../hooks/useChatActivity";
import type { UploadedMedia } from "../lib/api/media";
import { useToast } from "./Toast";
import { t } from "../i18n";
import { usePersonaName } from "../hooks/usePersonaName";
import { useSuperAgentConfig } from "../hooks/useGlobalConfig";

const PID = "0";
const CHANNEL = "web_sidebar" as const;

function todayId() {
  return new Date().toISOString().slice(0, 10);
}

export function RobyBubble({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const persona = usePersonaName();
  const { superAgent } = useSuperAgentConfig();
  const avatar = superAgent?.icon || SUPER_AGENT_ICON;
  const toast = useToast();
  const [model, setModel] = useState("");
  const [prefill, setPrefill] = useState({ text: "", n: 0 });
  const [dismissedAskKey, setDismissedAskKey] = useState<string | null>(null);
  // An inline arrow here is a NEW onError on every render, and useChat folds
  // onError into loadThread's identity — which is what the effect below waits
  // on. Through a ref so the callback can stay dep-free without going stale.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const onChatError = useCallback((m: string) => toastRef.current.error(m), []);
  const {
    msgs, send: sendChat, stop, clear, loadThread, streaming, queued,
    unqueue, sendNow, moveQueued, loading,
  } = useChat(PID, onChatError, { channel: CHANNEL });

  const queueKey = threadActivityKey(PID, CHANNEL, todayId());
  useChatVisibility(queueKey);

  // The dock is always mounted, so load the day's thread once — not on every
  // open, which would blank a turn still streaming when the sheet closed.
  //
  // Guarded by the day, not by a bare "already ran". A day with no thread yet
  // answers 404, which is legitimate — `optional` handles it — but its handler
  // blanks the pane, and that re-render used to hand this effect a brand new
  // loadThread and send it round again. The dock re-requested the same missing
  // thread thousands of times a second and the tab ate every GB the machine
  // had. The guard ends the loop; keying it by the day still lets the dock
  // pick up the new thread after midnight.
  const loadedDayRef = useRef<string | null>(null);
  useEffect(() => {
    const day = todayId();
    if (loadedDayRef.current === day) return;
    loadedDayRef.current = day;
    void loadThread(CHANNEL, day, { optional: true });
  }, [loadThread]);

  useEffect(() => {
    const onPreload = (e: Event) => {
      const text = (e as CustomEvent<{ prompt?: string }>).detail?.prompt;
      if (typeof text !== "string") return;
      onOpenChange(true);
      setPrefill((curr) => ({ text, n: curr.n + 1 }));
    };
    window.addEventListener("apx:roby-prompt", onPreload);
    return () => window.removeEventListener("apx:roby-prompt", onPreload);
  }, [onOpenChange]);

  useEffect(() => {
    const onClose = () => onOpenChange(false);
    window.addEventListener("apx:roby-close", onClose);
    return () => window.removeEventListener("apx:roby-close", onClose);
  }, [onOpenChange]);

  const send = async (text: string, media?: UploadedMedia[], opts?: { queue?: boolean }) => {
    await sendChat(text, {
      model: model || undefined,
      ...(media?.length ? { attachments: media } : {}),
      ...(opts?.queue ? { queue: true } : {}),
    });
  };

  const newChat = () => {
    if (streaming) return;
    clear(queueKey);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.info(t("project.chat.copied"));
    } catch {
      /* ignore */
    }
  };

  const pendingAsk = !streaming ? pendingAskQuestions(msgs) : null;
  const showAsk = pendingAsk && pendingAsk.turnKey !== dismissedAskKey;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="pr-12">
          <SheetTitle className="flex items-center gap-2">
            <AgentAvatar icon={avatar} name={persona} size={22} />
            {t("superagent.title", { persona })}
            <span className="text-xs font-normal text-muted-fg">{t("superagent.badge")}</span>
          </SheetTitle>
          <SheetDescription>{t("superagent.desc")}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {msgs.length || queued.length ? (
            <MessageList
              msgs={msgs}
              queued={queued}
              onCopy={copyToClipboard}
              faceFor={() => ({ icon: avatar, name: persona })}
            />
          ) : loading ? (
            <div className="grid h-full min-h-[200px] place-items-center p-8">
              <Loading />
            </div>
          ) : (
            <p className="mt-6 text-center text-sm text-muted-fg">{t("superagent.empty", { persona })}</p>
          )}
        </div>

        <div className="border-t border-border p-3">
          <Composer
            key={prefill.n}
            initialText={prefill.text || undefined}
            onSend={send}
            onStop={stop}
            streaming={streaming}
            model={model}
            onModelChange={setModel}
            allowFiles
            placeholder={t("superagent.placeholder")}
            context={
              <>
                <ContextBar msgs={msgs} projectId={PID} docked />
                <PendingTurns queued={queued} onUnqueue={unqueue} onSendNow={sendNow} onMove={moveQueued} docked />
                {showAsk && pendingAsk ? (
                  <InlineAskPanel
                    docked
                    turnKey={pendingAsk.turnKey}
                    questions={pendingAsk.questions}
                    onSubmit={(compiled) => void send(compiled)}
                    onDismiss={() => setDismissedAskKey(pendingAsk.turnKey)}
                    disabled={streaming}
                  />
                ) : null}
              </>
            }
          />
          <div className="mt-1.5 flex justify-end">
            <Button
              size="xs"
              variant="ghost"
              onClick={newChat}
              disabled={streaming || (msgs.length === 0 && queued.length === 0)}
            >
              <Plus className="size-3" /> {t("superagent.new_chat")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
