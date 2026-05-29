import { useState } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "../ui";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

interface Props {
  onSend: (text: string) => void | Promise<void>;
  onStop: () => void;
  streaming: boolean;
}

export function Composer({ onSend, onStop, streaming }: Props) {
  const [text, setText] = useState("");

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    void onSend(v);
  };

  return (
    <div className="border-t border-border bg-card/60 p-3">
      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("project.chat.placeholder")}
          className={cn(
            "flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none",
            "placeholder:text-muted-fg/60 focus:border-ring focus:ring-1 focus:ring-ring",
          )}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={streaming}
        />
        {streaming ? (
          <Button variant="destructive" onClick={onStop}>
            <Square size={13} /> {t("project.chat.stop")}
          </Button>
        ) : (
          <Button variant="primary" onClick={submit}>
            <Send size={13} /> {t("project.chat.send")}
          </Button>
        )}
      </div>
    </div>
  );
}
