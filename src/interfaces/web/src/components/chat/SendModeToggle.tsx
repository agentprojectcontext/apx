import { useEffect, useState } from "react";
import { ListPlus, Zap } from "lucide-react";
import { Button } from "../ui/button";
import { Tip } from "../ui/tip";
import { t } from "../../i18n";
import { queueOnSend, setQueueOnSend, onChatPrefsChange } from "../../lib/chat-prefs";

/**
 * Write during a running turn: interrupt it, or wait behind it?
 *
 * Interrupt is the default — it is what typing while an agent works almost
 * always means, and what a new message has always done on Telegram. Queueing
 * was the web's behaviour only because there was nothing to interrupt; it is
 * worth keeping on purpose ("finish that, then do this"), so it is a choice
 * rather than the only option. Per device, like the channel view/notify
 * choices: the phone and the desktop are used differently.
 *
 * One switch for every composer, not one per surface. The question it answers
 * is about the person, not about the pane they happen to be typing in — and a
 * coding session, where turns run for minutes, is exactly where the answer
 * matters most.
 */
export function SendModeToggle() {
  const [queues, setQueues] = useState(queueOnSend());
  useEffect(() => onChatPrefsChange(() => setQueues(queueOnSend())), []);
  const label = queues ? t("chat_ui.send_mode_queue") : t("chat_ui.send_mode_interrupt");
  return (
    <Tip content={queues ? t("chat_ui.send_mode_tip_queue") : t("chat_ui.send_mode_tip_interrupt")}>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
        aria-pressed={queues}
        data-testid="send-mode-toggle"
        onClick={() => setQueueOnSend(!queues)}
      >
        {queues ? <ListPlus className="size-3.5" /> : <Zap className="size-3.5" />}
        {label}
      </Button>
    </Tip>
  );
}
